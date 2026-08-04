package main

import "net/http"

// Discovery only lists what's already running, but it does so by executing a
// command on the host, so it sits behind the same write permission as any
// other remote execution (POST => PermWrite via protected).
func registerDiscoveryRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("POST /api/hosts/{id}/discover-services", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Type string `json:"type"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		host, ok := findHost(r.Context(), storage, r.PathValue("id"))
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

		result := DiscoverServices(host, cred, body.Type)
		detail := body.Type
		if result.Error != "" {
			detail += ": " + result.Error
		}
		auditLog.Log(r.Context(), "service.discover", "host", host.ID, host.Name, detail)
		writeJSON(w, http.StatusOK, result)
	}))

	// Polled by the graph, so not audit-logged -- same reasoning as
	// /ping and /metrics.
	mux.HandleFunc("POST /api/hosts/{id}/service-status", protectedAs(PermRead, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Names []string `json:"names"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		host, ok := findHost(r.Context(), storage, r.PathValue("id"))
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
		writeJSON(w, http.StatusOK, DockerServiceStatuses(host, cred, body.Names))
	}))
}
