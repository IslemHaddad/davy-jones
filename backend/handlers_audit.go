package main

import (
	"net/http"
	"strconv"
)

func registerAuditRoutes(mux *http.ServeMux, auditLog *AuditLogger, authMgr *AuthManager, sealMgr *SealManager) {
	mux.HandleFunc("GET /api/audit", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		opts := AuditListOptions{
			UserID:       r.URL.Query().Get("userId"),
			ActionPrefix: r.URL.Query().Get("action"),
		}
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			if n, err := strconv.Atoi(limitStr); err == nil {
				opts.Limit = n
			}
		}
		entries, err := auditLog.List(r.Context(), opts)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, entries)
	}))
}
