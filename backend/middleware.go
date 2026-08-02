package main

import (
	"net/http"
	"strings"
)

// requireSession protects a handler behind a valid, non-expired admin
// session token (obtained via POST /api/auth/login). Now that the browser
// talks to this server directly over the network, this replaces the old
// shared-secret sidecar token used when Rust was the only caller.
func requireSession(authMgr *AuthManager, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		sess, ok := authMgr.ValidateSession(token)
		if token == "" || !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		h(w, r.WithContext(withUser(r.Context(), sess.UserID, sess.Username)))
	}
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, prefix) {
		return strings.TrimPrefix(auth, prefix)
	}
	return ""
}

// requireUnsealed blocks handlers that touch encrypted data until the seal
// manager holds the master key in memory, attaching it to the request
// context so storage's encrypted read/write helpers can reach it.
func requireUnsealed(sealMgr *SealManager, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := sealMgr.Key()
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "sealed")
			return
		}
		h(w, r.WithContext(withSealKey(r.Context(), key)))
	}
}

// protected is the standard guard for any route touching infrastructure
// data: a valid session AND an unsealed master key, in that order so an
// unauthenticated caller learns nothing about seal state.
func protected(authMgr *AuthManager, sealMgr *SealManager, h http.HandlerFunc) http.HandlerFunc {
	return requireSession(authMgr, requireUnsealed(sealMgr, h))
}
