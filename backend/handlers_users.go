package main

import "net/http"

func registerUserRoutes(mux *http.ServeMux, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("GET /api/users", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		users, err := authMgr.ListUsers(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		out := make([]map[string]any, len(users))
		for i, u := range users {
			out[i] = publicUser(u)
		}
		writeJSON(w, http.StatusOK, out)
	}))

	mux.HandleFunc("POST /api/users", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		u, err := authMgr.CreateUser(r.Context(), body.Username, body.Password)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		auditLog.Log(r.Context(), "user.create", "user", u.ID, u.Username, "")
		writeJSON(w, http.StatusCreated, publicUser(u))
	}))

	mux.HandleFunc("DELETE /api/users/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := authMgr.DeleteUser(r.Context(), id); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		auditLog.Log(r.Context(), "user.delete", "user", id, "", "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
