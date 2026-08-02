package main

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// The app has its own session-token auth layer (checked on the first
	// WS message, not at the HTTP-upgrade level -- browsers can't attach
	// custom headers to WebSocket requests), so origin isn't the gate here.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// wsClientMsg covers every shape of message the client can send: the
// mandatory first "auth" message (which also carries the initial terminal
// size and, for a saved/streamed command, the command to run instead of an
// interactive shell), plus "input" and "resize" for the life of the session.
type wsClientMsg struct {
	Type    string `json:"type"`
	Token   string `json:"token,omitempty"`
	HostID  string `json:"hostId,omitempty"`
	Command string `json:"command,omitempty"`
	Data    string `json:"data,omitempty"`
	Cols    int    `json:"cols,omitempty"`
	Rows    int    `json:"rows,omitempty"`
}

// safeWSConn serializes writes -- gorilla's Conn is not safe for concurrent
// writers, and we have one goroutine streaming SSH output and another
// handling control messages.
type safeWSConn struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (w *safeWSConn) writeOutput(p []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteMessage(websocket.BinaryMessage, p)
}

func (w *safeWSConn) writeControl(v any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteJSON(v)
}

// wsOutputWriter adapts safeWSConn to io.Writer so it can be plugged in as
// an SSH session's Stdout.
type wsOutputWriter struct{ conn *safeWSConn }

func (w wsOutputWriter) Write(p []byte) (int, error) {
	if err := w.conn.writeOutput(p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func registerTerminalRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("GET /api/ws/ssh/session", func(w http.ResponseWriter, r *http.Request) {
		rawConn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer rawConn.Close()
		conn := &safeWSConn{conn: rawConn}

		// The first message must authenticate within 5s -- everything
		// needed to start the session (host, optional command, initial
		// size) rides along on it too, since it's the only message we know
		// is legitimate before checking the token.
		rawConn.SetReadDeadline(time.Now().Add(5 * time.Second))
		var first wsClientMsg
		if err := rawConn.ReadJSON(&first); err != nil || first.Type != "auth" {
			conn.writeControl(map[string]string{"type": "error", "message": "expected auth message"})
			return
		}
		rawConn.SetReadDeadline(time.Time{})

		sess, ok := authMgr.ValidateSession(first.Token)
		if !ok {
			conn.writeControl(map[string]string{"type": "error", "message": "unauthorized"})
			return
		}

		key, err := sealMgr.Key()
		if err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": "sealed"})
			return
		}
		ctx := withUser(withSealKey(r.Context(), key), sess.UserID, sess.Username)

		host, ok := findHost(ctx, storage, first.HostID)
		if !ok {
			conn.writeControl(map[string]string{"type": "error", "message": "host not found"})
			return
		}
		if !canAccessProject(ctx, storage, host.ProjectID) {
			conn.writeControl(map[string]string{"type": "error", "message": "not a member of this project"})
			return
		}
		cred, ok := findCredential(ctx, storage, host.CredentialID)
		if !ok {
			conn.writeControl(map[string]string{"type": "error", "message": "credential not found"})
			return
		}

		authMethod, err := sshAuthMethod(cred)
		if err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": err.Error()})
			return
		}

		sshConfig := &ssh.ClientConfig{
			User:            cred.Username,
			Auth:            []ssh.AuthMethod{authMethod},
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         cfg.SSHDialTimeout,
		}
		addr := net.JoinHostPort(host.IP, strconv.Itoa(hostPort(host)))
		client, err := ssh.Dial("tcp", addr, sshConfig)
		if err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": "dial failed: " + err.Error()})
			return
		}
		defer client.Close()

		session, err := client.NewSession()
		if err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": "session failed: " + err.Error()})
			return
		}
		defer session.Close()

		cols, rows := first.Cols, first.Rows
		if cols <= 0 {
			cols = 80
		}
		if rows <= 0 {
			rows = 24
		}
		modes := ssh.TerminalModes{
			ssh.ECHO:          1,
			ssh.TTY_OP_ISPEED: 14400,
			ssh.TTY_OP_OSPEED: 14400,
		}
		if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": "pty request failed: " + err.Error()})
			return
		}

		stdin, err := session.StdinPipe()
		if err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": err.Error()})
			return
		}
		session.Stdout = wsOutputWriter{conn: conn}

		if first.Command != "" {
			err = session.Start(first.Command)
		} else {
			err = session.Shell()
		}
		if err != nil {
			conn.writeControl(map[string]string{"type": "error", "message": "failed to start: " + err.Error()})
			return
		}

		conn.writeControl(map[string]string{"type": "ready"})

		if first.Command == "" {
			auditLog.Log(ctx, "ssh.shell.open", "host", host.ID, host.Name, "")
		} else {
			auditLog.Log(ctx, "ssh.command.run", "host", host.ID, host.Name, first.Command)
		}

		go func() {
			session.Wait()
			conn.writeControl(map[string]string{"type": "exit"})
			rawConn.Close()
		}()

		for {
			_, data, err := rawConn.ReadMessage()
			if err != nil {
				return
			}
			var msg wsClientMsg
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			switch msg.Type {
			case "input":
				stdin.Write([]byte(msg.Data))
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					_ = session.WindowChange(msg.Rows, msg.Cols)
				}
			}
		}
	})
}
