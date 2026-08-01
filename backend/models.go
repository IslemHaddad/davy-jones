package main

type Vpn struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Network           string `json:"network"` // CIDR
	ClientContainer   string `json:"clientContainer"`
	RemoteGateway     string `json:"remoteGateway"`
	Port              int    `json:"port"`              // default 10443
	ClientCertificate string `json:"clientCertificate"` // none|local|smartcard
	Username          string `json:"username"`
}

type Host struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	CredentialID string `json:"credentialId"`
	VpnID        string `json:"vpnId,omitempty"` // optional
	Port         int    `json:"port,omitempty"`  // SSH port; 0 means "use DJ_SSH_PORT default (22)"
}

type Service struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"` // e.g. Docker, Node, Nginx
	HostID string `json:"hostId"`
}

type Credential struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Username   string `json:"username"`
	Password   string `json:"password,omitempty"`   // optional
	PrivateKey string `json:"privateKey,omitempty"` // optional
	Passphrase string `json:"passphrase,omitempty"` // optional, decrypts PrivateKey if it's encrypted
}

type AdminConfig struct {
	PasswordHash string `json:"passwordHash"`
	IsSetup      bool   `json:"isSetup"`
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
