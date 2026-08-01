package main

import (
	"context"
	"net/http"
)

func findVpn(ctx context.Context, storage *Storage, id string) (Vpn, bool) {
	vpns, err := storage.GetVpns(ctx)
	if err != nil {
		return Vpn{}, false
	}
	for _, v := range vpns {
		if v.ID == id {
			return v, true
		}
	}
	return Vpn{}, false
}

func registerVPNRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager) {
	mux.HandleFunc("POST /api/vpns/{id}/docker/start", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		writeJSON(w, http.StatusOK, DockerStart(vpn.ClientContainer))
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/stop", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		writeJSON(w, http.StatusOK, DockerStop(vpn.ClientContainer))
	}))

	mux.HandleFunc("GET /api/vpns/{id}/docker/status", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		writeJSON(w, http.StatusOK, DockerStatus(vpn.ClientContainer))
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/ping", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		var body struct {
			TargetIP string `json:"targetIp"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		writeJSON(w, http.StatusOK, DockerExecPing(vpn.ClientContainer, body.TargetIP))
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/nc", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		var body struct {
			TargetIP string `json:"targetIp"`
			Port     int    `json:"port"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if body.Port == 0 {
			body.Port = 22
		}
		writeJSON(w, http.StatusOK, DockerExecNc(vpn.ClientContainer, body.TargetIP, body.Port))
	}))
}
