package main

import "net/http"

// Metrics are a passive poll, like /ping -- deliberately not audit-logged,
// otherwise the trail would be nothing but background reads.
func registerMetricsRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, collector *MetricsCollector) {
	mux.HandleFunc("GET /api/hosts/{id}/metrics", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, http.StatusOK, collector.Get(host, cred))
	}))
}
