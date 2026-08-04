package main

import (
	"fmt"
	"net/http"
	"time"
)

func registerProjectRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("GET /api/projects", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		projects, err := storage.GetProjects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		userID, _, _ := userFromContext(r.Context())
		visible := projects[:0]
		for _, p := range projects {
			if isProjectMember(p, userID) {
				visible = append(visible, p)
			}
		}
		writeJSON(w, http.StatusOK, visible)
	}))

	mux.HandleFunc("POST /api/projects", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var p Project
		if err := readJSON(r, &p); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		p.ID = newID("project")
		p.CreatedAt = time.Now()
		// The creator is always the first (and, at creation time, only)
		// member -- ignore whatever the client sent so nobody can seed a
		// project pre-populated with other people's access.
		userID, _, _ := userFromContext(r.Context())
		p.MemberIDs = []string{userID}
		projects, err := storage.GetProjects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		projects = append(projects, p)
		if err := storage.SaveProjects(r.Context(), projects); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "project.create", "project", p.ID, p.Name, "")
		writeJSON(w, http.StatusCreated, p)
	}))

	mux.HandleFunc("PUT /api/projects/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var updated Project
		if err := readJSON(r, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if len(updated.MemberIDs) == 0 {
			writeError(w, http.StatusBadRequest, "a project must keep at least one member")
			return
		}
		projects, err := storage.GetProjects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range projects {
			if projects[i].ID == id {
				userID, _, _ := userFromContext(r.Context())
				if !isProjectMember(projects[i], userID) {
					writeProjectForbidden(w)
					return
				}
				updated.ID = id
				updated.CreatedAt = projects[i].CreatedAt
				projects[i] = updated
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		if err := storage.SaveProjects(r.Context(), projects); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "project.update", "project", updated.ID, updated.Name, "")
		writeJSON(w, http.StatusOK, updated)
	}))

	mux.HandleFunc("DELETE /api/projects/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		projects, err := storage.GetProjects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		existing, ok := findProject(r.Context(), storage, id)
		if !ok {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		userID, _, _ := userFromContext(r.Context())
		if !isProjectMember(existing, userID) {
			writeProjectForbidden(w)
			return
		}
		var label string
		out := projects[:0]
		for _, p := range projects {
			if p.ID == id {
				label = p.Name
				continue
			}
			out = append(out, p)
		}
		if err := storage.SaveProjects(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "project.delete", "project", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	// The actual diagram/JSON generation happens client-side (all the data
	// it needs already reaches the browser via the list endpoints above for
	// the currently-open project). This endpoint exists purely so exporting
	// -- especially WITH real credentials -- lands in the audit trail; it's
	// the single most sensitive action in the app.
	// PermRead despite being a POST: nothing is modified, the method is only
	// used because it writes an audit entry. Whether the export can contain
	// real secrets is already decided by credential redaction on the list
	// endpoint, which is what the browser builds the file from.
	mux.HandleFunc("POST /api/projects/{id}/export", protectedAs(PermRead, authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Format         string `json:"format"` // "uml" | "json"
			IncludeSecrets bool   `json:"includeSecrets"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		project, ok := findProject(r.Context(), storage, id)
		if !ok {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
		userID, _, _ := userFromContext(r.Context())
		if !isProjectMember(project, userID) {
			writeProjectForbidden(w)
			return
		}
		auditLog.Log(r.Context(), "project.export_"+body.Format, "project", id, project.Name,
			fmt.Sprintf("includeSecrets=%v", body.IncludeSecrets))
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
