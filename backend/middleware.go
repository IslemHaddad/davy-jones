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
		h(w, r.WithContext(withSession(r.Context(), sess)))
	}
}

// requireRole gates a handler on the caller's role. It runs after
// requireSession, so the session (and its role) is already on the context.
func requireRole(perm Permission, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !roleAllows(roleFromContext(r.Context()), perm) {
			writeError(w, http.StatusForbidden, permissionDenied(perm))
			return
		}
		h(w, r)
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
//
// Role gating follows HTTP method semantics -- the safe methods (GET, HEAD)
// need read permission, everything else needs write. That default is right
// for the great majority of routes here; the handful where the method
// doesn't describe the actual power being exercised (the terminal WebSocket
// is a GET that opens a shell; user administration is admin-only; the
// export ping is a POST that only reads) call protectedAs explicitly instead.
func protected(authMgr *AuthManager, sealMgr *SealManager, h http.HandlerFunc) http.HandlerFunc {
	return requireSession(authMgr, func(w http.ResponseWriter, r *http.Request) {
		perm := PermWrite
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			perm = PermRead
		}
		requireRole(perm, requireUnsealed(sealMgr, h))(w, r)
	})
}

// protectedAs is protected with the role requirement stated outright.
func protectedAs(perm Permission, authMgr *AuthManager, sealMgr *SealManager, h http.HandlerFunc) http.HandlerFunc {
	return requireSession(authMgr, requireRole(perm, requireUnsealed(sealMgr, h)))
}
