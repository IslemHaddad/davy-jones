package main

import (
	"context"
	"net/http"
)

func findHost(ctx context.Context, storage *Storage, id string) (Host, bool) {
	hosts, err := storage.GetHosts(ctx)
	if err != nil {
		return Host{}, false
	}
	for _, h := range hosts {
		if h.ID == id {
			return h, true
		}
	}
	return Host{}, false
}

func findCredential(ctx context.Context, storage *Storage, id string) (Credential, bool) {
	creds, err := storage.GetCredentials(ctx)
	if err != nil {
		return Credential{}, false
	}
	for _, c := range creds {
		if c.ID == id {
			return c, true
		}
	}
	return Credential{}, false
}

func registerSSHRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("POST /api/ssh/exec", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			HostID  string `json:"hostId"`
			Command string `json:"command"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		host, ok := findHost(r.Context(), storage, body.HostID)
		if !ok {
			writeError(w, http.StatusNotFound, "host not found")
			return
		}
		if !canAccessProject(r.Context(), storage, host.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		cred, ok := findCredential(r.Context(), storage, host.CredentialID)
		if !ok {
			writeError(w, http.StatusNotFound, "credential not found for host")
			return
		}
		result := RunSSHCommand(host, cred, body.Command)
		auditLog.Log(r.Context(), "ssh.exec", "host", host.ID, host.Name, body.Command)
		writeJSON(w, http.StatusOK, result)
	}))

	mux.HandleFunc("GET /api/hosts/{id}/ping", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		host, ok := findHost(r.Context(), storage, id)
		if !ok {
			writeError(w, http.StatusNotFound, "host not found")
			return
		}
		if !canAccessProject(r.Context(), storage, host.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		online := TCPPing(host.IP, hostPort(host))
		writeJSON(w, http.StatusOK, map[string]bool{"online": online})
	}))
}
