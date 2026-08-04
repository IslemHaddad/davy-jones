package main

import "time"

type Vpn struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Image string `json:"image"` // docker image the client runs from, e.g. "openforti-runner"
	// ContainerName is the fixed name Start/Stop/Status/Logs/Ping/Nc all
	// target, e.g. "dj-vpn-oran". Explicit and user-defined rather than
	// derived, so it stays stable and visible instead of a hidden internal
	// value.
	ContainerName string `json:"containerName"`
	// Command is the shell command run on Start, e.g.
	// `docker run -d --name {{container}} --net=host --privileged -e VPN_HOST={{host}} ... {{image}}`.
	// Placeholders {{host}} {{port}} {{user}} {{pass}} {{image}} {{container}}
	// are substituted (shell-escaped) before execution.
	Command           string `json:"command"`
	RemoteGateway     string `json:"remoteGateway"`
	Port              int    `json:"port"`              // default 10443
	ClientCertificate string `json:"clientCertificate"` // none|local|smartcard
	CredentialID      string `json:"credentialId,omitempty"`
	ProjectID         string `json:"projectId,omitempty"` // "" == Unassigned
	// SharedProjectIDs lists further projects this VPN also appears in.
	// One physical tunnel is often the way into several clients'
	// environments, so a VPN is shareable rather than owned outright by
	// whichever project happened to create it. ProjectID stays the owner
	// (it is what Delete and re-provisioning are attributed to); sharing
	// only widens who can see and use it.
	SharedProjectIDs []string `json:"sharedProjectIds,omitempty"`
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
	Type      string `json:"type"` // e.g. Docker, Node, LXC
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
// empty ProjectID show up under the implicit "Unassigned" bucket (open to
// every user -- there is no owner to restrict it to); there is no
// migration that backfills existing data into a real project.
//
// MemberIDs is the project's access list: only these users can see or
// touch the project and anything tagged with its ID (see access.go). The
// creator is seeded as the first member; membership itself can only be
// changed by an existing member, so an outsider can't add themselves.
type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	MemberIDs   []string  `json:"memberIds,omitempty"`
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
	Role         Role      `json:"role,omitempty"` // "" == predates roles, see normalizeRole
	CreatedAt    time.Time `json:"createdAt"`
}

// NodePosition is where a node sits on the canvas, in the graph's own
// coordinate space (the same units React Flow reports on drag).
type NodePosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// GraphLayout is one project's hand-arranged canvas, keyed by the graph's
// node ids ("host-<id>", "vpn-<id>", "service-<id>"). Stored per project
// rather than per user on purpose: the arrangement is documentation of the
// environment -- everyone who opens the project, and every diagram exported
// from it, should see the same picture. Nodes with no entry fall back to the
// automatic layout, so this never needs backfilling.
type GraphLayout struct {
	ProjectID string                  `json:"projectId"` // "" == Unassigned
	Positions map[string]NodePosition `json:"positions"`
	UpdatedAt time.Time               `json:"updatedAt"`
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
