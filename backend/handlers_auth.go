package main

import (
	"net/http"
)

// Auth routes require the seal to be open (see requireUnsealed) but
// deliberately NOT a session -- there's no session to have yet at setup or
// login time. Unsealing itself (seal.go / handlers_seal.go) requires
// neither: the key shares are the authorization.
func registerAuthRoutes(mux *http.ServeMux, authMgr *AuthManager, sealMgr *SealManager) {
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
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if err := authMgr.SetupAdmin(r.Context(), body.Password); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("POST /api/auth/login", requireUnsealed(sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		token, err := authMgr.Login(r.Context(), body.Password)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": token})
	}))

	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		authMgr.Logout(body.Token)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("POST /api/auth/validate", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"valid": authMgr.ValidateSession(body.Token)})
	})
}
