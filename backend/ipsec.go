package main

import (
	"context"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
)

// IPsec credentials -- an additive feature module.
//
// A FortiClient/openfortivpn tunnel authenticates with an SSH-style
// username+password, which is what Credential already models. An IPsec
// tunnel (IKEv1/IKEv2, strongSwan, libreswan, Cisco/Fortinet gateways)
// needs a different and larger set of secrets: a pre-shared key or an
// X.509 keypair, IKE identities on both ends, an optional XAUTH/EAP user,
// and the crypto proposals the gateway insists on. Squeezing those into
// Credential would either overload fields that mean something else
// (Password holding a PSK) or add six mostly-empty columns to every SSH
// credential in the system.
//
// So this is its own resource, in its own encrypted file, reached through
// its own routes -- nothing in the existing credential/host/VPN paths
// changes behaviour when the feature is unused. The one place it meets the
// existing code is the container command: applyIpsec substitutes
// {{ipsec*}} placeholders before the VPN's command is rendered.
type IpsecCredential struct {
	ID   string `json:"id"`
	Name string `json:"name"`

	// IkeMode is how the tunnel authenticates, as a single choice rather
	// than a matrix. The four values are the ones a strongSwan client
	// actually distinguishes, and they map 1:1 onto the ipsec-vpn image's
	// VPN_IKE_MODE:
	//
	//   ikev2-eap    IKEv2, username/password over EAP-MSCHAPv2; the
	//                gateway proves itself with a certificate. No client
	//                secret material at all.
	//   ikev2-psk    IKEv2 with a pre-shared key.
	//   ikev1-xauth  IKEv1 with a group PSK plus an XAuth login. The
	//                legacy Cisco/Fortinet style.
	//   ikev2-cert   IKEv2 with a client certificate and private key.
	//
	// This replaced an earlier authMode of "psk"/"certificate", which could
	// not express ikev2-eap -- the most common corporate setup, and the
	// image's own default -- because it demanded either a PSK or a keypair
	// and EAP has neither. AuthMode below is kept only to migrate records
	// written before this field existed.
	IkeMode string `json:"ikeMode"`

	// AuthMode is the superseded discriminator. Read on load to derive
	// IkeMode for old records (see normalizeIkeMode); never written.
	//
	// Deprecated: use IkeMode.
	AuthMode string `json:"authMode,omitempty"`

	// IkeVersion is 1 or 2; 0 means "derive it from IkeMode". Kept as its
	// own field because {{ipsecIkeVersion}} is part of the placeholder
	// contract for images that want the bare number.
	IkeVersion int `json:"ikeVersion,omitempty"`

	// PSK is the pre-shared key ("ikev2-psk"), or the *group* secret for
	// "ikev1-xauth" -- IKEv1 aggressive mode has only the one shared
	// secret, with the per-user login carried separately over XAuth.
	PSK string `json:"psk,omitempty"`

	// Certificate / PrivateKey are the *client* X.509 material
	// ("ikev2-cert"). PEM, multi-line.
	Certificate string `json:"certificate,omitempty"`
	PrivateKey  string `json:"privateKey,omitempty"`

	// Passphrase decrypts PrivateKey. Note that the bundled ipsec-vpn image
	// loads keys with `swanctl --noprompt` and so cannot use an encrypted
	// key -- this is here for other images, and the UI says as much.
	Passphrase string `json:"passphrase,omitempty"`

	// GatewayCert is the *gateway's* certificate or issuing CA, used as a
	// trust anchor. Distinct from Certificate above, which is ours.
	//
	// IPsec has no equivalent of clicking through a browser warning: the
	// gateway certificate arrives inside IKE_AUTH and cannot be probed
	// ahead of time, so a self-signed gateway is unusable in the EAP and
	// cert modes until its certificate is pinned here.
	GatewayCert string `json:"gatewayCert,omitempty"`

	// LocalID / RemoteID are the IKE identities (leftid/rightid). Gateways
	// frequently key their policy on these, and getting them wrong is the
	// single most common cause of a phase-1 that dies with no useful log.
	LocalID  string `json:"localId,omitempty"`
	RemoteID string `json:"remoteId,omitempty"`

	// Group is the IKEv1 group/aggressive-mode group name some gateways
	// (Cisco, older FortiGate) require alongside the PSK.
	Group string `json:"group,omitempty"`

	// Username / Password are the XAUTH (IKEv1) or EAP (IKEv2) second
	// factor: a per-user login on top of the tunnel-level auth above.
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`

	// IkeProposal / EspProposal are the phase-1 / phase-2 algorithm sets,
	// e.g. "aes256-sha256-modp2048" / "aes256-sha256". Left empty the
	// client's defaults apply.
	IkeProposal string `json:"ikeProposal,omitempty"`
	EspProposal string `json:"espProposal,omitempty"`

	// RemoteTS is the set of subnets routed into the tunnel, e.g.
	// "10.0.0.0/8,192.168.0.0/16". Empty means the client's default, which
	// for strongSwan is 0.0.0.0/0 -- everything.
	//
	// This is the most consequential field here. davy-jones reaches hosts
	// behind a VPN *directly* from its own host (vpnId on a Host is only a
	// topology annotation -- SSH and TCP ping never traverse the
	// container), so the tunnel container has to run --net=host for its
	// routes to apply. A full-tunnel default combined with --net=host
	// installs a default route over the VPN for the whole machine,
	// including the operator's own SSH session to it. Narrow this.
	RemoteTS string `json:"remoteTs,omitempty"`

	// LocalTS is our side's traffic selector. Empty means "dynamic", i.e.
	// whatever virtual IP the gateway assigns, which is nearly always right.
	LocalTS string `json:"localTs,omitempty"`

	// Userland requests ESP in userspace (strongSwan's kernel-libipsec)
	// instead of the kernel XFRM stack, for hosts where XFRM is
	// unavailable. Needs /dev/net/tun in the container.
	Userland bool `json:"userland,omitempty"`

	ProjectID string `json:"projectId,omitempty"`
}

// IKE modes, matching the ipsec-vpn image's VPN_IKE_MODE values exactly.
const (
	IkeModeEapV2   = "ikev2-eap"
	IkeModePskV2   = "ikev2-psk"
	IkeModeXauthV1 = "ikev1-xauth"
	IkeModeCertV2  = "ikev2-cert"
)

// normalizeIkeMode fills in IkeMode for a record written before the field
// existed, mapping the old authMode/ikeVersion pair onto the closest of the
// four modes. Certificate becomes ikev2-cert; a PSK with ikeVersion 1
// becomes ikev1-xauth, since IKEv1 with a shared secret in this app always
// meant the XAuth flavour; anything else becomes ikev2-psk.
//
// Applied on read rather than as a one-shot migration so there is no
// rewrite step that has to succeed before the data is usable.
func normalizeIkeMode(c IpsecCredential) IpsecCredential {
	if c.IkeMode != "" {
		return c
	}
	switch {
	case c.AuthMode == ipsecAuthCertificate:
		c.IkeMode = IkeModeCertV2
	case c.IkeVersion == 1:
		c.IkeMode = IkeModeXauthV1
	default:
		c.IkeMode = IkeModePskV2
	}
	return c
}

// ikeVersionFor reports the IKE version a mode implies, so
// {{ipsecIkeVersion}} stays meaningful without the operator having to keep
// a redundant field in step with the mode.
func ikeVersionFor(c IpsecCredential) int {
	if c.IkeVersion != 0 {
		return c.IkeVersion
	}
	if c.IkeMode == IkeModeXauthV1 {
		return 1
	}
	return 2
}

// IpsecConfig is the whole of this feature's persisted state, in one
// encrypted file.
//
// Bindings maps a VPN id to the IPsec credential its container command
// draws {{ipsec*}} placeholders from. It lives here rather than as a field
// on Vpn deliberately: adding a column to Vpn would mean every VPN
// create/update path has to carry and preserve it, and a client that
// didn't know about the field would silently blank it on the next save --
// exactly the class of bug this feature was asked to avoid.
type IpsecConfig struct {
	Credentials []IpsecCredential `json:"credentials"`
	Bindings    map[string]string `json:"bindings"`
}

const ipsecFile = "ipsec.json"

func (s *Storage) GetIpsecConfig(ctx context.Context) (IpsecConfig, error) {
	key, err := sealKey(ctx)
	if err != nil {
		return IpsecConfig{}, err
	}
	var cfg IpsecConfig
	err = s.readEncrypted(ipsecFile, key, &cfg)
	if cfg.Credentials == nil {
		cfg.Credentials = []IpsecCredential{}
	}
	if cfg.Bindings == nil {
		cfg.Bindings = map[string]string{}
	}
	for i := range cfg.Credentials {
		cfg.Credentials[i] = normalizeIkeMode(cfg.Credentials[i])
	}
	return cfg, err
}

func (s *Storage) SaveIpsecConfig(ctx context.Context, cfg IpsecConfig) error {
	key, err := sealKey(ctx)
	if err != nil {
		return err
	}
	if cfg.Credentials == nil {
		cfg.Credentials = []IpsecCredential{}
	}
	if cfg.Bindings == nil {
		cfg.Bindings = map[string]string{}
	}
	return s.writeEncrypted(ipsecFile, key, cfg)
}

// redactIpsecCredential strips every secret, leaving what the UI needs to
// show that a profile exists and how it's configured. Same rule as
// redactCredential: a role that may look at the infrastructure must not be
// handed the keys to it.
func redactIpsecCredential(c IpsecCredential) IpsecCredential {
	c.PSK = ""
	c.PrivateKey = ""
	c.Passphrase = ""
	c.Password = ""
	// The certificate itself is public material, but it's returned blank
	// anyway -- it is only ever paired with the private key, and there's
	// nothing a redacted view does with it.
	c.Certificate = ""
	// GatewayCert is likewise public (it's what the gateway presents to
	// every client), and is left in place: the UI shows whether a trust
	// anchor is pinned, which is exactly the thing you want to check when
	// a phase-1 is failing.
	return c
}

const ipsecAuthCertificate = "certificate" // legacy authMode value, migration only

func validateIpsecCredential(c IpsecCredential) error {
	if strings.TrimSpace(c.Name) == "" {
		return errors.New("name is required")
	}
	// Each mode names exactly the material it cannot authenticate without.
	// Anything else is optional: a gateway that wants no XAuth login, or a
	// certificate that chains to a public CA, must not be made to invent
	// values it doesn't have.
	switch c.IkeMode {
	case IkeModeEapV2:
		if strings.TrimSpace(c.Username) == "" || strings.TrimSpace(c.Password) == "" {
			return errors.New("username and password are both required for IKEv2 EAP")
		}
	case IkeModePskV2:
		if strings.TrimSpace(c.PSK) == "" {
			return errors.New("pre-shared key is required for IKEv2 PSK")
		}
	case IkeModeXauthV1:
		if strings.TrimSpace(c.PSK) == "" {
			return errors.New("group pre-shared key is required for IKEv1 XAuth")
		}
		if strings.TrimSpace(c.Username) == "" || strings.TrimSpace(c.Password) == "" {
			return errors.New("XAuth username and password are both required for IKEv1 XAuth")
		}
	case IkeModeCertV2:
		if strings.TrimSpace(c.Certificate) == "" || strings.TrimSpace(c.PrivateKey) == "" {
			return errors.New("client certificate and private key are both required for IKEv2 certificate authentication")
		}
	default:
		return errors.New("ikeMode must be one of: ikev2-eap, ikev2-psk, ikev1-xauth, ikev2-cert")
	}
	if c.IkeVersion != 0 && c.IkeVersion != 1 && c.IkeVersion != 2 {
		return errors.New("ikeVersion must be 1 or 2")
	}
	// Values are substituted into the VPN's container command before the
	// command's own {{host}}/{{user}}/{{pass}} placeholders are resolved.
	// A value that itself contained "{{" would therefore be re-scanned by
	// that second pass and could be rewritten into something the operator
	// never typed. Nothing legitimate needs that sequence in a PSK or an
	// IKE identity, so it's refused at the boundary and the two passes
	// stay independent by construction.
	for label, v := range map[string]string{
		"pre-shared key":          c.PSK,
		"local ID":                c.LocalID,
		"remote ID":               c.RemoteID,
		"group":                   c.Group,
		"username":                c.Username,
		"password":                c.Password,
		"IKE proposal":            c.IkeProposal,
		"ESP proposal":            c.EspProposal,
		"key passphrase":          c.Passphrase,
		"certificate":             c.Certificate,
		"private key":             c.PrivateKey,
		"gateway certificate":     c.GatewayCert,
		"remote traffic selector": c.RemoteTS,
		"local traffic selector":  c.LocalTS,
	} {
		if strings.Contains(v, "{{") {
			return errors.New(label + ` must not contain "{{"`)
		}
	}
	return nil
}

// b64 encodes non-empty PEM for transport through a shell + docker -e. An
// empty value stays empty rather than becoming the encoding of "", so an
// unset certificate reaches the container as an unset variable and the
// image's own `${VAR:-default}` fallbacks still fire.
func b64(s string) string {
	if s == "" {
		return ""
	}
	return base64.StdEncoding.EncodeToString([]byte(s))
}

// ipsecBindings returns the {{...}} token → value mapping a VPN's container
// command may draw on, in the order the UI lists them.
//
// Token and value are written on one line together rather than kept in two
// parallel slices indexed against each other. That split was survivable at
// thirteen entries and is a live hazard at twenty-one: inserting a token
// without inserting its value at the identical position silently shifts
// every later pair, which would substitute (say) a private key wherever a
// proposal string was expected. Here that mistake isn't expressible.
//
// The *B64 variants exist because PEM is multi-line and these values are
// destined for `docker run -e VAR=...` inside a shell command. A literal
// newline survives that path only by luck of quoting at every hop; base64
// is a single line of [A-Za-z0-9+/=] that no hop can mangle. The ipsec-vpn
// image accepts a path, raw PEM, or base64 for exactly this reason, which
// is why the preset uses the base64 form.
func ipsecBindings(c IpsecCredential) []struct{ Token, Value string } {
	// The zero credential has no mode, and must not claim one: an empty
	// {{ipsecIkeMode}} lets the image fall back to its own default rather
	// than being handed a mode it then fails to validate.
	ikeVersion, ikeMode, userland := "", "", ""
	if c.IkeMode != "" {
		ikeMode = c.IkeMode
		ikeVersion = strconv.Itoa(ikeVersionFor(c))
		userland = "0"
		if c.Userland {
			userland = "1"
		}
	}
	return []struct{ Token, Value string }{
		{"{{ipsecPsk}}", c.PSK},
		{"{{ipsecIkeMode}}", ikeMode},
		{"{{ipsecAuthMode}}", c.AuthMode},
		{"{{ipsecIkeVersion}}", ikeVersion},
		{"{{ipsecLocalId}}", c.LocalID},
		{"{{ipsecRemoteId}}", c.RemoteID},
		{"{{ipsecGroup}}", c.Group},
		{"{{ipsecUser}}", c.Username},
		{"{{ipsecPass}}", c.Password},
		{"{{ipsecIkeProposal}}", c.IkeProposal},
		{"{{ipsecEspProposal}}", c.EspProposal},
		{"{{ipsecRemoteTs}}", c.RemoteTS},
		{"{{ipsecLocalTs}}", c.LocalTS},
		{"{{ipsecUserland}}", userland},
		{"{{ipsecCert}}", c.Certificate},
		{"{{ipsecCertB64}}", b64(c.Certificate)},
		{"{{ipsecKey}}", c.PrivateKey},
		{"{{ipsecKeyB64}}", b64(c.PrivateKey)},
		{"{{ipsecKeyPassphrase}}", c.Passphrase},
		{"{{ipsecGatewayCert}}", c.GatewayCert},
		{"{{ipsecGatewayCertB64}}", b64(c.GatewayCert)},
	}
}

// ipsecPlaceholders are the tokens alone, for anything that needs to show
// or check the set without resolving a credential.
func ipsecPlaceholders() []string {
	bindings := ipsecBindings(IpsecCredential{})
	out := make([]string, 0, len(bindings))
	for _, b := range bindings {
		out = append(out, b.Token)
	}
	return out
}

// ipsecReplacements pairs each placeholder with its shell-escaped value, in
// the argument form strings.NewReplacer wants. The zero credential yields
// empty (but still quoted) values, so a command that references a
// placeholder on a VPN with no profile bound gets ” rather than the
// literal token -- the same choice vpnCredential makes for {{user}}/{{pass}}.
func ipsecReplacements(c IpsecCredential) []string {
	bindings := ipsecBindings(c)
	pairs := make([]string, 0, len(bindings)*2)
	for _, b := range bindings {
		pairs = append(pairs, b.Token, shellQuote(b.Value))
	}
	return pairs
}

// applyIpsec returns the VPN with its IPsec placeholders already resolved
// in Command, ready for the existing render/provision path to substitute
// the rest. Called by the two places that build a container.
//
// Everything about it is fail-soft: no binding, a binding pointing at a
// deleted profile, or a storage error all fall through to empty values
// rather than an error. Provisioning a VPN that doesn't use this feature
// must not become able to fail because of it.
func applyIpsec(ctx context.Context, storage *Storage, v Vpn) Vpn {
	if !strings.Contains(v.Command, "{{ipsec") {
		return v
	}
	cred, _ := ipsecForVpn(ctx, storage, v.ID)
	v.Command = strings.NewReplacer(ipsecReplacements(cred)...).Replace(v.Command)
	return v
}

// ipsecForVpn resolves the profile bound to a VPN, if any.
func ipsecForVpn(ctx context.Context, storage *Storage, vpnID string) (IpsecCredential, bool) {
	cfg, err := storage.GetIpsecConfig(ctx)
	if err != nil {
		return IpsecCredential{}, false
	}
	credID, ok := cfg.Bindings[vpnID]
	if !ok || credID == "" {
		return IpsecCredential{}, false
	}
	for _, c := range cfg.Credentials {
		if c.ID == credID {
			return c, true
		}
	}
	return IpsecCredential{}, false
}
