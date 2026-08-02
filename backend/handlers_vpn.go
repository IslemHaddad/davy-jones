package main

import (
	"context"
	"fmt"
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

func registerVPNRoutes(mux *http.ServeMux, storage *Storage, authMgr *AuthManager, sealMgr *SealManager, auditLog *AuditLogger) {
	mux.HandleFunc("POST /api/vpns/{id}/docker/start", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessProject(r.Context(), storage, vpn.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		result := DockerStart(vpn)
		auditLog.Log(r.Context(), "vpn.docker.start", "vpn", vpn.ID, vpn.Name, "")
		writeJSON(w, http.StatusOK, result)
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/stop", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessProject(r.Context(), storage, vpn.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		result := DockerStop(vpn)
		auditLog.Log(r.Context(), "vpn.docker.stop", "vpn", vpn.ID, vpn.Name, "")
		writeJSON(w, http.StatusOK, result)
	}))

	mux.HandleFunc("GET /api/vpns/{id}/docker/status", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessProject(r.Context(), storage, vpn.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		writeJSON(w, http.StatusOK, DockerStatus(vpn))
	}))

	mux.HandleFunc("GET /api/vpns/{id}/docker/logs", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessProject(r.Context(), storage, vpn.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		writeJSON(w, http.StatusOK, DockerLogs(vpn, 200))
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/ping", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessProject(r.Context(), storage, vpn.ProjectID) {
			writeProjectForbidden(w)
			return
		}
		var body struct {
			TargetIP string `json:"targetIp"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		result := DockerExecPing(vpn, body.TargetIP)
		auditLog.Log(r.Context(), "vpn.docker.ping", "vpn", vpn.ID, vpn.Name, body.TargetIP)
		writeJSON(w, http.StatusOK, result)
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/nc", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessProject(r.Context(), storage, vpn.ProjectID) {
			writeProjectForbidden(w)
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
		result := DockerExecNc(vpn, body.TargetIP, body.Port)
		auditLog.Log(r.Context(), "vpn.docker.nc", "vpn", vpn.ID, vpn.Name, fmt.Sprintf("%s:%d", body.TargetIP, body.Port))
		writeJSON(w, http.StatusOK, result)
	}))
}
