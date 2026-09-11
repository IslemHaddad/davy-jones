package main

import (
	"encoding/base64"
	"strings"
	"testing"
)

// The preset command in the frontend passes every VPN_* the ipsec-vpn image
// reads. If a token here stops resolving, that command reaches `docker run`
// with a literal "{{ipsecFoo}}" in it and the container starts with a
// nonsense value rather than failing loudly -- so pin the whole set.
func TestIpsecPlaceholdersAllResolve(t *testing.T) {
	cred := IpsecCredential{
		IkeMode:     IkeModeCertV2,
		Certificate: "CERT",
		PrivateKey:  "KEY",
		GatewayCert: "GWCERT",
	}
	command := strings.Join(ipsecPlaceholders(), " ")
	got := strings.NewReplacer(ipsecReplacements(cred)...).Replace(command)

	if strings.Contains(got, "{{") {
		t.Fatalf("unresolved placeholder in %q", got)
	}
}

// Token and value are written on one line each in ipsecBindings precisely so
// they cannot drift apart. This checks the property that guarantees.
func TestIpsecBindingsPairCorrectly(t *testing.T) {
	cred := IpsecCredential{
		IkeMode:  IkeModeXauthV1,
		PSK:      "group-secret",
		Username: "alice",
		Password: "pw",
		RemoteTS: "10.0.0.0/8",
	}
	resolve := func(token string) string {
		out := strings.NewReplacer(ipsecReplacements(cred)...).Replace(token)
		return strings.Trim(out, "'")
	}

	for token, want := range map[string]string{
		"{{ipsecPsk}}":        "group-secret",
		"{{ipsecUser}}":       "alice",
		"{{ipsecPass}}":       "pw",
		"{{ipsecRemoteTs}}":   "10.0.0.0/8",
		"{{ipsecIkeMode}}":    IkeModeXauthV1,
		"{{ipsecIkeVersion}}": "1",
	} {
		if got := resolve(token); got != want {
			t.Errorf("%s = %q, want %q", token, got, want)
		}
	}
}

// PEM is multi-line and ends up inside `docker run -e VAR=...` in a shell
// command; the base64 form is what makes that survivable. It has to decode
// back to exactly what was stored.
func TestIpsecBase64RoundTrip(t *testing.T) {
	pem := "-----BEGIN CERTIFICATE-----\nline two\n-----END CERTIFICATE-----"
	cred := IpsecCredential{IkeMode: IkeModeCertV2, Certificate: pem, PrivateKey: "k"}

	encoded := strings.Trim(
		strings.NewReplacer(ipsecReplacements(cred)...).Replace("{{ipsecCertB64}}"),
		"'",
	)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(decoded) != pem {
		t.Errorf("round trip = %q, want %q", decoded, pem)
	}
	if strings.ContainsAny(encoded, "\n'") {
		t.Errorf("encoded value is not shell/env safe: %q", encoded)
	}
}

// An unbound VPN must not receive a mode it never chose: the image resolves
// every VPN_* with ${VAR:-default}, so empty is what lets its own defaults
// apply. A hardcoded "ikev2-psk" here would make it demand a PSK instead.
func TestIpsecZeroCredentialYieldsEmptyMode(t *testing.T) {
	for _, token := range []string{"{{ipsecIkeMode}}", "{{ipsecIkeVersion}}", "{{ipsecUserland}}"} {
		got := strings.NewReplacer(ipsecReplacements(IpsecCredential{})...).Replace(token)
		if got != "''" {
			t.Errorf("%s on zero credential = %q, want ''", token, got)
		}
	}
}

func TestValidateIpsecCredentialPerMode(t *testing.T) {
	base := IpsecCredential{Name: "n"}

	tests := []struct {
		name string
		cred IpsecCredential
		ok   bool
	}{
		{"eap needs a login", with(base, func(c *IpsecCredential) {
			c.IkeMode = IkeModeEapV2
		}), false},
		{"eap with a login", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.Username, c.Password = IkeModeEapV2, "u", "p"
		}), true},
		// The case the old psk/certificate model could not express at all.
		{"eap needs no psk or cert", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.Username, c.Password = IkeModeEapV2, "u", "p"
			c.PSK, c.Certificate, c.PrivateKey = "", "", ""
		}), true},
		{"psk needs a psk", with(base, func(c *IpsecCredential) {
			c.IkeMode = IkeModePskV2
		}), false},
		{"psk with a psk", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.PSK = IkeModePskV2, "s"
		}), true},
		{"xauth needs a login too", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.PSK = IkeModeXauthV1, "s"
		}), false},
		{"xauth complete", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.PSK, c.Username, c.Password = IkeModeXauthV1, "s", "u", "p"
		}), true},
		{"cert needs both halves", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.Certificate = IkeModeCertV2, "c"
		}), false},
		{"cert complete", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.Certificate, c.PrivateKey = IkeModeCertV2, "c", "k"
		}), true},
		{"unknown mode", with(base, func(c *IpsecCredential) {
			c.IkeMode = "ikev9-magic"
		}), false},
		{"name is required", with(base, func(c *IpsecCredential) {
			c.Name, c.IkeMode, c.PSK = "", IkeModePskV2, "s"
		}), false},
		// Guards the two substitution passes against each other.
		{"braces refused", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.PSK = IkeModePskV2, "{{host}}"
		}), false},
		{"braces refused in traffic selector", with(base, func(c *IpsecCredential) {
			c.IkeMode, c.PSK, c.RemoteTS = IkeModePskV2, "s", "{{x}}"
		}), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIpsecCredential(tc.cred)
			if tc.ok && err != nil {
				t.Errorf("expected valid, got %v", err)
			}
			if !tc.ok && err == nil {
				t.Error("expected an error, got nil")
			}
		})
	}
}

// Records written before IkeMode existed still have to resolve to a usable
// mode, since the read path is the only migration there is.
func TestNormalizeIkeModeMigratesLegacyAuthMode(t *testing.T) {
	for _, tc := range []struct {
		authMode string
		version  int
		want     string
	}{
		{"certificate", 0, IkeModeCertV2},
		{"psk", 1, IkeModeXauthV1},
		{"psk", 2, IkeModePskV2},
		{"psk", 0, IkeModePskV2},
	} {
		got := normalizeIkeMode(IpsecCredential{AuthMode: tc.authMode, IkeVersion: tc.version})
		if got.IkeMode != tc.want {
			t.Errorf("authMode=%q version=%d -> %q, want %q",
				tc.authMode, tc.version, got.IkeMode, tc.want)
		}
	}

	// An explicit mode always wins over the legacy pair.
	got := normalizeIkeMode(IpsecCredential{IkeMode: IkeModeEapV2, AuthMode: "certificate"})
	if got.IkeMode != IkeModeEapV2 {
		t.Errorf("explicit mode overwritten: got %q", got.IkeMode)
	}
}

// applyIpsec must stay a no-op for every VPN that doesn't opt in -- the
// whole feature is additive, and a command with no {{ipsec}} tokens must
// come back byte-identical.
func TestApplyIpsecLeavesUnrelatedCommandsAlone(t *testing.T) {
	v := Vpn{Command: "docker run -d --name {{container}} -e VPN_USER={{user}} {{image}}"}
	if got := applyIpsec(nil, nil, v); got.Command != v.Command {
		t.Errorf("command rewritten:\n got %q\nwant %q", got.Command, v.Command)
	}
}

func with(c IpsecCredential, f func(*IpsecCredential)) IpsecCredential {
	f(&c)
	return c
}
