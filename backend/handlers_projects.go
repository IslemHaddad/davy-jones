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
		writeJSON(w, http.StatusOK, projects)
	}))

	mux.HandleFunc("POST /api/projects", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var p Project
		if err := readJSON(r, &p); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		p.ID = newID("project")
		p.CreatedAt = time.Now()
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
		projects, err := storage.GetProjects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range projects {
			if projects[i].ID == id {
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
	mux.HandleFunc("POST /api/projects/{id}/export", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var body struct {
			Format         string `json:"format"` // "uml" | "json"
			IncludeSecrets bool   `json:"includeSecrets"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		projects, err := storage.GetProjects(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var label string
		for _, p := range projects {
			if p.ID == id {
				label = p.Name
				break
			}
		}
		auditLog.Log(r.Context(), "project.export_"+body.Format, "project", id, label,
			fmt.Sprintf("includeSecrets=%v", body.IncludeSecrets))
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
