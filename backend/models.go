package main

import "time"

type Vpn struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Network           string `json:"network"` // CIDR
	ClientContainer   string `json:"clientContainer"`
	RemoteGateway     string `json:"remoteGateway"`
	Port              int    `json:"port"`              // default 10443
	ClientCertificate string `json:"clientCertificate"` // none|local|smartcard
	Username          string `json:"username"`
	ProjectID         string `json:"projectId,omitempty"` // "" == Unassigned
}

type Host struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	CredentialID string `json:"credentialId"`
	VpnID        string `json:"vpnId,omitempty"` // optional
	Port         int    `json:"port,omitempty"`  // SSH port; 0 means "use DJ_SSH_PORT default (22)"
	ProjectID    string `json:"projectId,omitempty"`
}

type Service struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"` // e.g. Docker, Node, Nginx
	HostID    string `json:"hostId"`
	ProjectID string `json:"projectId,omitempty"`
}

type Credential struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Username   string `json:"username"`
	Password   string `json:"password,omitempty"`   // optional
	PrivateKey string `json:"privateKey,omitempty"` // optional
	Passphrase string `json:"passphrase,omitempty"` // optional, decrypts PrivateKey if it's encrypted
	ProjectID  string `json:"projectId,omitempty"`
}

// Project groups vpns/hosts/services/credentials that belong to one
// client/environment -- e.g. "Client A" vs "Client B". Resources with an
// empty ProjectID show up under the implicit "Unassigned" bucket; there is
// no migration that backfills existing data into a real project.
type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminConfig struct {
	PasswordHash string `json:"passwordHash"`
	IsSetup      bool   `json:"isSetup"`
}

// User replaces AdminConfig as the source of truth for login. Multiple users
// are supported but deliberately flat -- there is no role/permission tier,
// every logged-in user has equal access. The only reason for named accounts
// is attributing actions in the audit log instead of sharing one password.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
}

// SavedCommand is a named shell command bound to a host -- e.g. "Tail nginx"
// -> `docker logs -f nginx`, or "Pod logs" -> `kubectl logs -n prod api-0`.
// Running one streams live output over the same PTY/WebSocket channel used
// for the interactive shell (see terminal.go).
type SavedCommand struct {
	ID      string `json:"id"`
	HostID  string `json:"hostId"`
	Name    string `json:"name"`
	Command string `json:"command"`
}
