package main

import (
	"net/http"
	"time"
)

// Layout positions are not audit-logged: dragging a box is a view change,
// not an action on infrastructure, and logging every drag would bury the
// entries that matter.
func registerLayoutRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager) {
	mux.HandleFunc("GET /api/layout", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		projectID := r.URL.Query().Get("projectId")
		if !canAccessProject(r.Context(), storage, projectID) {
			writeProjectForbidden(w)
			return
		}
		layouts, err := storage.GetLayouts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, l := range layouts {
			if l.ProjectID == projectID {
				writeJSON(w, http.StatusOK, l)
				return
			}
		}
		// No saved arrangement yet -- an empty map, not a 404: the caller
		// wants "where do these nodes go", and "nowhere in particular" is a
		// perfectly good answer that means "use the automatic layout".
		writeJSON(w, http.StatusOK, GraphLayout{
			ProjectID: projectID,
			Positions: map[string]NodePosition{},
		})
	}))

	mux.HandleFunc("PUT /api/layout", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var body GraphLayout
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if !canAccessProject(r.Context(), storage, body.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		if body.Positions == nil {
			body.Positions = map[string]NodePosition{}
		}
		body.UpdatedAt = time.Now()

		layouts, err := storage.GetLayouts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		replaced := false
		for i := range layouts {
			if layouts[i].ProjectID == body.ProjectID {
				layouts[i] = body
				replaced = true
				break
			}
		}
		if !replaced {
			layouts = append(layouts, body)
		}
		if err := storage.SaveLayouts(r.Context(), layouts); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, body)
	}))
}
