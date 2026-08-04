package main

import "errors"

// Role is a global permission level, orthogonal to project membership:
// membership decides *which* projects you can touch, Role decides *what kind
// of operation* you may perform in them. Both must allow an action.
type Role string

const (
	// RoleAdmin can do everything, including managing users and roles.
	RoleAdmin Role = "admin"
	// RoleReadWrite is a normal operator: full read and write, no user
	// administration.
	RoleReadWrite Role = "readwrite"
	// RoleRead can look but not touch -- and explicitly cannot see
	// credential secrets or open a shell, since either would hand over
	// exactly what read-only is meant to withhold.
	RoleRead Role = "read"
	// RoleWrite can change things but not read them back. Narrow by
	// design; useful for an account that only feeds data in.
	RoleWrite Role = "write"
)

// normalizeRole resolves a stored role to an effective one. An empty role
// means the account predates roles existing: those installs had no
// permission tiers at all, so every user could do everything -- resolving
// blank to admin preserves exactly that rather than locking an operator out
// of their own system on upgrade. Every account created from now on carries
// an explicit role (see AuthManager.CreateUser).
func normalizeRole(r Role) Role {
	switch r {
	case RoleAdmin, RoleReadWrite, RoleRead, RoleWrite:
		return r
	default:
		return RoleAdmin
	}
}

func validateRole(r Role) error {
	switch r {
	case RoleAdmin, RoleReadWrite, RoleRead, RoleWrite:
		return nil
	}
	return errors.New("role must be one of: admin, readwrite, read, write")
}

func canRead(r Role) bool {
	switch normalizeRole(r) {
	case RoleAdmin, RoleReadWrite, RoleRead:
		return true
	}
	return false
}

func canWrite(r Role) bool {
	switch normalizeRole(r) {
	case RoleAdmin, RoleReadWrite, RoleWrite:
		return true
	}
	return false
}

// canReadSecrets gates the plaintext password/private key/passphrase on a
// Credential. Deliberately narrower than canRead: a read-only account is
// meant to be able to see the shape of the infrastructure without walking
// away with the keys to it.
func canReadSecrets(r Role) bool {
	switch normalizeRole(r) {
	case RoleAdmin, RoleReadWrite:
		return true
	}
	return false
}

func isAdmin(r Role) bool {
	return normalizeRole(r) == RoleAdmin
}

// Permission is what a route demands of the caller's role.
type Permission int

const (
	PermRead Permission = iota
	PermWrite
	PermAdmin
)

func roleAllows(r Role, p Permission) bool {
	switch p {
	case PermRead:
		return canRead(r)
	case PermWrite:
		return canWrite(r)
	case PermAdmin:
		return isAdmin(r)
	}
	return false
}

func permissionDenied(p Permission) string {
	switch p {
	case PermWrite:
		return "your role does not allow making changes"
	case PermAdmin:
		return "administrator role required"
	default:
		return "your role does not allow reading this"
	}
}

// redactCredential strips the secret material from a credential, leaving the
// parts the UI needs to render (name, username, which project it's in) so a
// read-only user still sees that a host *has* a credential without being
// handed its contents.
func redactCredential(c Credential) Credential {
	c.Password = ""
	c.PrivateKey = ""
	c.Passphrase = ""
	return c
}
