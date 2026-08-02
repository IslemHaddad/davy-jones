package main

import (
	"context"
	"fmt"
	"net/http"
)

// provisionVpnContainer (re)builds a VPN's docker container right after
// it's created or edited, so Start/Stop afterward just toggle an
// already-existing container instead of building one from scratch on every
// click. Best-effort: a docker failure here doesn't fail the request, since
// the VPN's config is already saved -- it's recorded in the audit log so
// it's visible without blocking on it.
func provisionVpnContainer(ctx context.Context, storage *Storage, auditLog *AuditLogger, v Vpn) {
	var cred Credential
	if v.CredentialID != "" {
		if c, ok := findCredential(ctx, storage, v.CredentialID); ok {
			cred = c
		}
	}
	result := DockerProvision(v, cred)
	detail := fmt.Sprintf("exit=%d", result.ExitCode)
	if result.Error != "" {
		detail = result.Error
	} else if result.ExitCode != 0 && result.Stderr != "" {
		detail = result.Stderr
	}
	auditLog.Log(ctx, "vpn.docker.provision", "vpn", v.ID, v.Name, detail)
}

// filterByProjectAccess narrows items to what the caller may see: an exact
// match to ?projectId= when present (the caller's access to that specific
// project is checked by the handler before calling this), or -- when
// absent -- everything in Unassigned plus every project the caller
// belongs to. Before project access control existed, an absent projectId
// meant "unfiltered" outright; now that projects restrict access, "no
// filter" must never leak a restricted project's items, so it's resolved
// per-item instead. Filtering happens server-side rather than in the
// browser specifically because these lists include SSH passwords/private
// keys (Credential) -- no reason to ship another project's secrets over
// the wire when this is a few lines.
func filterByProjectAccess[T any](r *http.Request, storage *Storage, items []T, projectID func(T) string) []T {
	if r.URL.Query().Has("projectId") {
		pid := r.URL.Query().Get("projectId")
		out := items[:0]
		for _, it := range items {
			if projectID(it) == pid {
				out = append(out, it)
			}
		}
		return out
	}
	out := items[:0]
	for _, it := range items {
		if canAccessProject(r.Context(), storage, projectID(it)) {
			out = append(out, it)
		}
	}
	return out
}

func registerConfigRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	// VPNs
	mux.HandleFunc("GET /api/vpns", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("projectId") && !canAccessProject(r.Context(), storage, r.URL.Query().Get("projectId")) {
			writeProjectForbidden(w)
			return
		}
		vpns, err := storage.GetVpns(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		vpns = filterByProjectAccess(r, storage, vpns, func(v Vpn) string { return v.ProjectID })
		writeJSON(w, http.StatusOK, vpns)
	}))
	mux.HandleFunc("POST /api/vpns", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var v Vpn
		if err := readJSON(r, &v); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if !canAccessProject(r.Context(), storage, v.ProjectID) {
			writeProjectForbidden(w)
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
		provisionVpnContainer(r.Context(), storage, auditLog, v)
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
				if !canAccessProject(r.Context(), storage, vpns[i].ProjectID) || !canAccessProject(r.Context(), storage, updated.ProjectID) {
					writeProjectForbidden(w)
					return
				}
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
		provisionVpnContainer(r.Context(), storage, auditLog, updated)
		writeJSON(w, http.StatusOK, updated)
	}))
	mux.HandleFunc("DELETE /api/vpns/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		vpns, err := storage.GetVpns(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var deleted Vpn
		var found bool
		for _, v := range vpns {
			if v.ID == id {
				deleted = v
				found = true
				break
			}
		}
		if found && !canAccessProject(r.Context(), storage, deleted.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		out := vpns[:0]
		for _, v := range vpns {
			if v.ID != id {
				out = append(out, v)
			}
		}
		if found {
			DockerRemove(deleted)
		}
		if err := storage.SaveVpns(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "vpn.delete", "vpn", id, deleted.Name, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	// Hosts
	mux.HandleFunc("GET /api/hosts", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("projectId") && !canAccessProject(r.Context(), storage, r.URL.Query().Get("projectId")) {
			writeProjectForbidden(w)
			return
		}
		hosts, err := storage.GetHosts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		hosts = filterByProjectAccess(r, storage, hosts, func(h Host) string { return h.ProjectID })
		writeJSON(w, http.StatusOK, hosts)
	}))
	mux.HandleFunc("POST /api/hosts", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var h Host
		if err := readJSON(r, &h); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if !canAccessProject(r.Context(), storage, h.ProjectID) {
			writeProjectForbidden(w)
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
				if !canAccessProject(r.Context(), storage, hosts[i].ProjectID) || !canAccessProject(r.Context(), storage, updated.ProjectID) {
					writeProjectForbidden(w)
					return
				}
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
		var existingProjectID string
		var found bool
		for _, h := range hosts {
			if h.ID == id {
				label = h.Name
				existingProjectID = h.ProjectID
				found = true
				break
			}
		}
		if found && !canAccessProject(r.Context(), storage, existingProjectID) {
			writeProjectForbidden(w)
			return
		}
		out := hosts[:0]
		for _, h := range hosts {
			if h.ID != id {
				out = append(out, h)
			}
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
		if r.URL.Query().Has("projectId") && !canAccessProject(r.Context(), storage, r.URL.Query().Get("projectId")) {
			writeProjectForbidden(w)
			return
		}
		services, err := storage.GetServices(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		services = filterByProjectAccess(r, storage, services, func(s Service) string { return s.ProjectID })
		writeJSON(w, http.StatusOK, services)
	}))
	mux.HandleFunc("POST /api/services", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var s Service
		if err := readJSON(r, &s); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if !canAccessProject(r.Context(), storage, s.ProjectID) {
			writeProjectForbidden(w)
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
				if !canAccessProject(r.Context(), storage, services[i].ProjectID) || !canAccessProject(r.Context(), storage, updated.ProjectID) {
					writeProjectForbidden(w)
					return
				}
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
		var existingProjectID string
		var found bool
		for _, s := range services {
			if s.ID == id {
				label = s.Name
				existingProjectID = s.ProjectID
				found = true
				break
			}
		}
		if found && !canAccessProject(r.Context(), storage, existingProjectID) {
			writeProjectForbidden(w)
			return
		}
		out := services[:0]
		for _, s := range services {
			if s.ID != id {
				out = append(out, s)
			}
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
		if r.URL.Query().Has("projectId") && !canAccessProject(r.Context(), storage, r.URL.Query().Get("projectId")) {
			writeProjectForbidden(w)
			return
		}
		creds, err := storage.GetCredentials(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		creds = filterByProjectAccess(r, storage, creds, func(c Credential) string { return c.ProjectID })
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
		if !canAccessProject(r.Context(), storage, c.ProjectID) {
			writeProjectForbidden(w)
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
				if !canAccessProject(r.Context(), storage, creds[i].ProjectID) || !canAccessProject(r.Context(), storage, updated.ProjectID) {
					writeProjectForbidden(w)
					return
				}
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
		var existingProjectID string
		var found bool
		for _, c := range creds {
			if c.ID == id {
				label = c.Name
				existingProjectID = c.ProjectID
				found = true
				break
			}
		}
		if found && !canAccessProject(r.Context(), storage, existingProjectID) {
			writeProjectForbidden(w)
			return
		}
		out := creds[:0]
		for _, c := range creds {
			if c.ID != id {
				out = append(out, c)
			}
		}
		if err := storage.SaveCredentials(r.Context(), out); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "credential.delete", "credential", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}
