package main

import "net/http"

func registerSavedCommandRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager) {
	mux.HandleFunc("GET /api/saved-commands", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		cmds, err := storage.GetSavedCommands(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, cmds)
	}))

	mux.HandleFunc("POST /api/saved-commands", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var c SavedCommand
		if err := readJSON(r, &c); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		c.ID = newID("cmd")
		cmds, err := storage.GetSavedCommands(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		cmds = append(cmds, c)
		if err := storage.SaveSavedCommands(r.Context(), cmds); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, c)
	}))

	mux.HandleFunc("PUT /api/saved-commands/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var updated SavedCommand
		if err := readJSON(r, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		cmds, err := storage.GetSavedCommands(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range cmds {
			if cmds[i].ID == id {
				updated.ID = id
				cmds[i] = updated
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "saved command not found")
			return
		}
		if err := storage.SaveSavedCommands(r.Context(), cmds); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
	}))

	mux.HandleFunc("DELETE /api/saved-commands/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		cmds, err := storage.GetSavedCommands(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		out := cmds[:0]
		for _, c := range cmds {
			if c.ID != id {
				out = append(out, c)
			}
		}
		if err := storage.SaveSavedCommands(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
