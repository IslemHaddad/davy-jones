package main

import "testing"

func TestRolePermissions(t *testing.T) {
	cases := []struct {
		role                       Role
		read, write, secrets, admn bool
	}{
		{RoleAdmin, true, true, true, true},
		{RoleReadWrite, true, true, true, false},
		{RoleRead, true, false, false, false},
		{RoleWrite, false, true, false, false},
	}
	for _, c := range cases {
		if got := canRead(c.role); got != c.read {
			t.Errorf("%s canRead: got %v, want %v", c.role, got, c.read)
		}
		if got := canWrite(c.role); got != c.write {
			t.Errorf("%s canWrite: got %v, want %v", c.role, got, c.write)
		}
		if got := canReadSecrets(c.role); got != c.secrets {
			t.Errorf("%s canReadSecrets: got %v, want %v", c.role, got, c.secrets)
		}
		if got := isAdmin(c.role); got != c.admn {
			t.Errorf("%s isAdmin: got %v, want %v", c.role, got, c.admn)
		}
	}
}

func TestReadOnlyCannotReadSecrets(t *testing.T) {
	// The whole point of the read role: sees the infrastructure, not the keys.
	if canReadSecrets(RoleRead) {
		t.Fatal("read-only role must not be able to read credential secrets")
	}
	if !canRead(RoleRead) {
		t.Fatal("read-only role must still be able to read")
	}
}

func TestBlankRoleStaysFullyCapable(t *testing.T) {
	// Accounts predating roles must not be locked out on upgrade.
	if !canRead("") || !canWrite("") || !isAdmin("") {
		t.Fatal("a blank (pre-roles) role must resolve to admin")
	}
	if normalizeRole("bogus") != RoleAdmin {
		t.Fatal("an unrecognised role must resolve to admin, not silently deny")
	}
}

func TestValidateRoleRejectsUnknown(t *testing.T) {
	// normalizeRole is lenient for stored data, but anything a client sets
	// has to be a real role.
	for _, r := range []Role{RoleAdmin, RoleReadWrite, RoleRead, RoleWrite} {
		if err := validateRole(r); err != nil {
			t.Errorf("validateRole(%s): unexpected error %v", r, err)
		}
	}
	for _, r := range []Role{"", "root", "ReadWrite"} {
		if err := validateRole(r); err == nil {
			t.Errorf("validateRole(%q): expected an error", r)
		}
	}
}

func TestRedactCredentialKeepsIdentityDropsSecrets(t *testing.T) {
	c := redactCredential(Credential{
		ID: "cred_1", Name: "prod", Username: "deploy",
		Password: "hunter2", PrivateKey: "-----BEGIN", Passphrase: "pp",
		ProjectID: "proj_1",
	})
	if c.Password != "" || c.PrivateKey != "" || c.Passphrase != "" {
		t.Fatalf("secret survived redaction: %+v", c)
	}
	if c.ID != "cred_1" || c.Name != "prod" || c.Username != "deploy" || c.ProjectID != "proj_1" {
		t.Fatalf("redaction dropped non-secret fields: %+v", c)
	}
}

func TestRoleAllows(t *testing.T) {
	if roleAllows(RoleRead, PermWrite) {
		t.Error("read must not satisfy PermWrite")
	}
	if roleAllows(RoleWrite, PermRead) {
		t.Error("write-only must not satisfy PermRead")
	}
	if roleAllows(RoleReadWrite, PermAdmin) {
		t.Error("readwrite must not satisfy PermAdmin")
	}
	if !roleAllows(RoleAdmin, PermAdmin) {
		t.Error("admin must satisfy PermAdmin")
	}
}
