package main

import (
	"net/http"
)

func publicUser(u User) map[string]any {
	return map[string]any{
		"id":        u.ID,
		"username":  u.Username,
		"createdAt": u.CreatedAt,
	}
}

// Auth routes require the seal to be open (see requireUnsealed) but
// deliberately NOT a session -- there's no session to have yet at setup or
// login time. Unsealing itself (seal.go / handlers_seal.go) requires
// neither: the key shares are the authorization.
func registerAuthRoutes(mux *http.ServeMux, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("GET /api/auth/status", requireUnsealed(sealMgr, func(w http.ResponseWriter, r *http.Request) {
		isSetup, err := authMgr.IsSetup(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"isSetup": isSetup})
	}))

	mux.HandleFunc("POST /api/auth/setup", requireUnsealed(sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		u, err := authMgr.CreateFirstUser(r.Context(), body.Username, body.Password)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		auditLog.Log(withUser(r.Context(), u.ID, u.Username), "auth.setup", "user", u.ID, u.Username, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("POST /api/auth/login", requireUnsealed(sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		token, user, err := authMgr.Login(r.Context(), body.Username, body.Password)
		if err != nil {
			auditLog.Log(withUser(r.Context(), "", body.Username), "auth.login_failed", "user", "", body.Username, "")
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		auditLog.Log(withUser(r.Context(), user.ID, user.Username), "auth.login", "user", user.ID, user.Username, "")
		writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": publicUser(user)})
	}))

	mux.HandleFunc("POST /api/auth/logout", requireUnsealed(sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if sess, ok := authMgr.SessionForToken(body.Token); ok {
			auditLog.Log(withUser(r.Context(), sess.UserID, sess.Username), "auth.logout", "user", sess.UserID, sess.Username, "")
		}
		authMgr.Logout(body.Token)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("POST /api/auth/validate", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		sess, ok := authMgr.ValidateSession(body.Token)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]bool{"valid": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"valid": true,
			"user":  map[string]string{"id": sess.UserID, "username": sess.Username},
		})
	})
}
