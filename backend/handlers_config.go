package main

import (
	"net/http"
)

// filterByProjectID narrows items to the ?projectId= query param, when
// present. Absent entirely -> unfiltered (back-compat / cross-project
// tooling). Present but empty -> the "Unassigned" bucket (items whose
// ProjectID is ""). Filtering happens server-side rather than in the
// browser specifically because these lists include SSH passwords/private
// keys (Credential) -- no reason to ship another project's secrets over
// the wire when this is a few lines.
func filterByProjectID[T any](r *http.Request, items []T, projectID func(T) string) []T {
	if !r.URL.Query().Has("projectId") {
		return items
	}
	pid := r.URL.Query().Get("projectId")
	out := items[:0]
	for _, it := range items {
		if projectID(it) == pid {
			out = append(out, it)
		}
	}
	return out
}

func registerConfigRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	// VPNs
	mux.HandleFunc("GET /api/vpns", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpns, err := storage.GetVpns(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		vpns = filterByProjectID(r, vpns, func(v Vpn) string { return v.ProjectID })
		writeJSON(w, http.StatusOK, vpns)
	}))
	mux.HandleFunc("POST /api/vpns", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var v Vpn
		if err := readJSON(r, &v); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if v.Port == 0 {
			v.Port = 10443
		}
		v.ID = newID("vpn")
		vpns, err := storage.GetVpns(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		vpns = append(vpns, v)
		if err := storage.SaveVpns(r.Context(), vpns); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "vpn.create", "vpn", v.ID, v.Name, "")
		writeJSON(w, http.StatusCreated, v)
	}))
	mux.HandleFunc("PUT /api/vpns/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var updated Vpn
		if err := readJSON(r, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		vpns, err := storage.GetVpns(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range vpns {
			if vpns[i].ID == id {
				updated.ID = id
				vpns[i] = updated
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if err := storage.SaveVpns(r.Context(), vpns); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "vpn.update", "vpn", updated.ID, updated.Name, "")
		writeJSON(w, http.StatusOK, updated)
	}))
	mux.HandleFunc("DELETE /api/vpns/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		vpns, err := storage.GetVpns(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var label string
		out := vpns[:0]
		for _, v := range vpns {
			if v.ID == id {
				label = v.Name
				continue
			}
			out = append(out, v)
		}
		if err := storage.SaveVpns(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "vpn.delete", "vpn", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	// Hosts
	mux.HandleFunc("GET /api/hosts", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		hosts, err := storage.GetHosts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		hosts = filterByProjectID(r, hosts, func(h Host) string { return h.ProjectID })
		writeJSON(w, http.StatusOK, hosts)
	}))
	mux.HandleFunc("POST /api/hosts", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var h Host
		if err := readJSON(r, &h); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		h.ID = newID("host")
		hosts, err := storage.GetHosts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		hosts = append(hosts, h)
		if err := storage.SaveHosts(r.Context(), hosts); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "host.create", "host", h.ID, h.Name, "")
		writeJSON(w, http.StatusCreated, h)
	}))
	mux.HandleFunc("PUT /api/hosts/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var updated Host
		if err := readJSON(r, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		hosts, err := storage.GetHosts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range hosts {
			if hosts[i].ID == id {
				updated.ID = id
				hosts[i] = updated
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "host not found")
			return
		}
		if err := storage.SaveHosts(r.Context(), hosts); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "host.update", "host", updated.ID, updated.Name, "")
		writeJSON(w, http.StatusOK, updated)
	}))
	mux.HandleFunc("DELETE /api/hosts/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		hosts, err := storage.GetHosts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var label string
		out := hosts[:0]
		for _, h := range hosts {
			if h.ID == id {
				label = h.Name
				continue
			}
			out = append(out, h)
		}
		if err := storage.SaveHosts(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "host.delete", "host", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	// Services
	mux.HandleFunc("GET /api/services", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		services, err := storage.GetServices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		services = filterByProjectID(r, services, func(s Service) string { return s.ProjectID })
		writeJSON(w, http.StatusOK, services)
	}))
	mux.HandleFunc("POST /api/services", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var s Service
		if err := readJSON(r, &s); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		s.ID = newID("svc")
		services, err := storage.GetServices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		services = append(services, s)
		if err := storage.SaveServices(r.Context(), services); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "service.create", "service", s.ID, s.Name, "")
		writeJSON(w, http.StatusCreated, s)
	}))
	mux.HandleFunc("PUT /api/services/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var updated Service
		if err := readJSON(r, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		services, err := storage.GetServices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range services {
			if services[i].ID == id {
				updated.ID = id
				services[i] = updated
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "service not found")
			return
		}
		if err := storage.SaveServices(r.Context(), services); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "service.update", "service", updated.ID, updated.Name, "")
		writeJSON(w, http.StatusOK, updated)
	}))
	mux.HandleFunc("DELETE /api/services/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		services, err := storage.GetServices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var label string
		out := services[:0]
		for _, s := range services {
			if s.ID == id {
				label = s.Name
				continue
			}
			out = append(out, s)
		}
		if err := storage.SaveServices(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "service.delete", "service", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	// Credentials
	mux.HandleFunc("GET /api/credentials", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		creds, err := storage.GetCredentials(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		creds = filterByProjectID(r, creds, func(c Credential) string { return c.ProjectID })
		writeJSON(w, http.StatusOK, creds)
	}))
	mux.HandleFunc("POST /api/credentials", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var c Credential
		if err := readJSON(r, &c); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if c.Password == "" && c.PrivateKey == "" {
			writeError(w, http.StatusBadRequest, "credential needs a password or a private key")
			return
		}
		c.ID = newID("cred")
		creds, err := storage.GetCredentials(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		creds = append(creds, c)
		if err := storage.SaveCredentials(r.Context(), creds); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "credential.create", "credential", c.ID, c.Name, "")
		writeJSON(w, http.StatusCreated, c)
	}))
	mux.HandleFunc("PUT /api/credentials/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var updated Credential
		if err := readJSON(r, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if updated.Password == "" && updated.PrivateKey == "" {
			writeError(w, http.StatusBadRequest, "credential needs a password or a private key")
			return
		}
		creds, err := storage.GetCredentials(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		found := false
		for i := range creds {
			if creds[i].ID == id {
				updated.ID = id
				creds[i] = updated
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "credential not found")
			return
		}
		if err := storage.SaveCredentials(r.Context(), creds); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "credential.update", "credential", updated.ID, updated.Name, "")
		writeJSON(w, http.StatusOK, updated)
	}))
	mux.HandleFunc("DELETE /api/credentials/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		creds, err := storage.GetCredentials(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var label string
		out := creds[:0]
		for _, c := range creds {
			if c.ID == id {
				label = c.Name
				continue
			}
			out = append(out, c)
		}
		if err := storage.SaveCredentials(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "credential.delete", "credential", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
