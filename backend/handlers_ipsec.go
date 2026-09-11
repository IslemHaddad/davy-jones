package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// maxIpsecBody caps the request body. Certificate + key PEM is the largest
// thing that legitimately arrives here and that is a few kilobytes; 256 KiB
// is generous and still bounds what an authenticated client can make the
// server buffer.
const maxIpsecBody = 256 << 10

func registerIpsecRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("GET /api/ipsec-credentials", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("projectId") && !canAccessProject(r.Context(), storage, r.URL.Query().Get("projectId")) {
			writeProjectForbidden(w)
			return
		}
		cfg, err := storage.GetIpsecConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		creds := filterByProjectAccess(r, storage, cfg.Credentials, func(c IpsecCredential) string { return c.ProjectID })
		// Same boundary as /api/credentials: secrets are stripped in the
		// response, not in the browser.
		if !canReadSecrets(roleFromContext(r.Context())) {
			for i := range creds {
				creds[i] = redactIpsecCredential(creds[i])
			}
		}
		writeJSON(w, http.StatusOK, creds)
	}))

	mux.HandleFunc("POST /api/ipsec-credentials", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		var c IpsecCredential
		if err := readIpsecJSON(w, r, &c); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if err := validateIpsecCredential(c); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if !canAccessProject(r.Context(), storage, c.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		cfg, err := storage.GetIpsecConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		c.ID = newID("ipsec")
		cfg.Credentials = append(cfg.Credentials, c)
		if err := storage.SaveIpsecConfig(r.Context(), cfg); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "ipsec.create", "ipsecCredential", c.ID, c.Name, c.IkeMode)
		writeJSON(w, http.StatusCreated, c)
	}))

	// PUT is a *merge*, not a replace.
	//
	// The replace form is what makes an edit destructive: any field the
	// client leaves out comes back as its zero value and overwrites what
	// was stored -- so a form that only sends what it displays silently
	// wipes the project assignment, or blanks a secret it never showed,
	// and the record reads as deleted from wherever it used to appear.
	// Decoding onto the existing record instead means absent keys keep
	// their stored value, and only a key that is actually present (empty
	// string included, so a secret can still be cleared on purpose)
	// changes anything.
	mux.HandleFunc("PUT /api/ipsec-credentials/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxIpsecBody))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		cfg, err := storage.GetIpsecConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		idx := -1
		for i := range cfg.Credentials {
			if cfg.Credentials[i].ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			writeError(w, http.StatusNotFound, "ipsec credential not found")
			return
		}
		updated := cfg.Credentials[idx]
		if err := json.Unmarshal(body, &updated); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		updated.ID = id
		if err := validateIpsecCredential(updated); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Both the project it was in and the project it's moving to have
		// to be ones the caller belongs to -- otherwise an edit is a way
		// to push a record into, or pull one out of, a project you have
		// no access to.
		if !canAccessProject(r.Context(), storage, cfg.Credentials[idx].ProjectID) || !canAccessProject(r.Context(), storage, updated.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		cfg.Credentials[idx] = updated
		if err := storage.SaveIpsecConfig(r.Context(), cfg); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "ipsec.update", "ipsecCredential", updated.ID, updated.Name, "")
		writeJSON(w, http.StatusOK, updated)
	}))

	mux.HandleFunc("DELETE /api/ipsec-credentials/{id}", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		cfg, err := storage.GetIpsecConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var label string
		found := false
		for _, c := range cfg.Credentials {
			if c.ID == id {
				if !canAccessProject(r.Context(), storage, c.ProjectID) {
					writeProjectForbidden(w)
					return
				}
				label = c.Name
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusNotFound, "ipsec credential not found")
			return
		}
		out := cfg.Credentials[:0]
		for _, c := range cfg.Credentials {
			if c.ID != id {
				out = append(out, c)
			}
		}
		cfg.Credentials = out
		// Bindings to the deleted profile go with it. A dangling binding
		// would resolve to empty values at provision time, which looks
		// like the tunnel losing its credentials for no visible reason.
		for vpnID, credID := range cfg.Bindings {
			if credID == id {
				delete(cfg.Bindings, vpnID)
			}
		}
		if err := storage.SaveIpsecConfig(r.Context(), cfg); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "ipsec.delete", "ipsecCredential", id, label, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	// Which profile a VPN uses. Kept on this side of the API rather than as
	// a field on the VPN itself, so the VPN's own create/update payload is
	// untouched by this feature (see IpsecConfig).
	mux.HandleFunc("GET /api/vpns/{id}/ipsec", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessVpn(r.Context(), storage, vpn) {
			writeProjectForbidden(w)
			return
		}
		cfg, err := storage.GetIpsecConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"credentialId": cfg.Bindings[vpn.ID]})
	}))

	mux.HandleFunc("PUT /api/vpns/{id}/ipsec", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessVpn(r.Context(), storage, vpn) {
			writeProjectForbidden(w)
			return
		}
		var body struct {
			CredentialID string `json:"credentialId"`
		}
		if err := readIpsecJSON(w, r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		cfg, err := storage.GetIpsecConfig(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		label := "cleared"
		if body.CredentialID == "" {
			delete(cfg.Bindings, vpn.ID)
		} else {
			var cred IpsecCredential
			for _, c := range cfg.Credentials {
				if c.ID == body.CredentialID {
					cred = c
					break
				}
			}
			if cred.ID == "" {
				writeError(w, http.StatusNotFound, "ipsec credential not found")
				return
			}
			if !canAccessProject(r.Context(), storage, cred.ProjectID) {
				writeProjectForbidden(w)
				return
			}
			if cfg.Bindings == nil {
				cfg.Bindings = map[string]string{}
			}
			cfg.Bindings[vpn.ID] = cred.ID
			label = cred.Name
		}
		if err := storage.SaveIpsecConfig(r.Context(), cfg); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		auditLog.Log(r.Context(), "ipsec.bind", "vpn", vpn.ID, vpn.Name, label)
		writeJSON(w, http.StatusOK, map[string]string{"credentialId": cfg.Bindings[vpn.ID]})
	}))
}

func readIpsecJSON(w http.ResponseWriter, r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, maxIpsecBody)).Decode(v)
}
