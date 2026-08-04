package main

import "net/http"

// User administration is admin-only rather than method-gated: creating an
// account, handing it a role, or deleting one are all ways to change who can
// do what, so a plain write role must not reach them.
func registerUserRoutes(mux *http.ServeMux, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	// Listing users stays open to any reader -- the project members picker
	// needs it, and it carries no secrets.
	mux.HandleFunc("GET /api/users", protectedAs(PermRead, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
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

	// Changing your own password is the one user-management action that is
	// not admin-only -- every account needs it, including read-only ones, so
	// this is gated on PermRead (the floor every role clears) rather than
	// PermAdmin. The path is "me", not "{id}": there is deliberately no way
	// to name someone else's account here, so the route can't become a
	// password reset for other users by way of a missing ownership check.
	mux.HandleFunc("POST /api/users/me/password", protectedAs(PermRead, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			CurrentPassword string `json:"currentPassword"`
			NewPassword     string `json:"newPassword"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		userID, username, ok := userFromContext(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		err := authMgr.ChangePassword(
			r.Context(), userID, body.CurrentPassword, body.NewPassword, bearerToken(r))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Worth an entry even though it names no target but the actor: an
		// account's password changing is exactly the kind of event someone
		// reading the trail after an incident is looking for.
		auditLog.Log(r.Context(), "user.password_change", "user", userID, username, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("POST /api/users", protectedAs(PermAdmin, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Role     Role   `json:"role"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if body.Role == "" {
			body.Role = RoleReadWrite
		}
		u, err := authMgr.CreateUser(r.Context(), body.Username, body.Password, body.Role)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		auditLog.Log(r.Context(), "user.create", "user", u.ID, u.Username, string(u.Role))
		writeJSON(w, http.StatusCreated, publicUser(u))
	}))

	mux.HandleFunc("PUT /api/users/{id}/role", protectedAs(PermAdmin, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Role Role `json:"role"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		u, err := authMgr.SetUserRole(r.Context(), r.PathValue("id"), body.Role)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		auditLog.Log(r.Context(), "user.role_change", "user", u.ID, u.Username, string(u.Role))
		writeJSON(w, http.StatusOK, publicUser(u))
	}))

	mux.HandleFunc("DELETE /api/users/{id}", protectedAs(PermAdmin, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := authMgr.DeleteUser(r.Context(), id); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		auditLog.Log(r.Context(), "user.delete", "user", id, "", "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
