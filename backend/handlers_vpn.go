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
		if !canAccessVpn(r.Context(), storage, vpn) {
			writeProjectForbidden(w)
			return
		}
		// applyIpsec only matters on the rebuild branch (Start on an
		// existing container doesn't re-run the command), and is a no-op
		// for a VPN whose command has no {{ipsec*}} placeholders.
		result, rebuilt := DockerStart(applyIpsec(r.Context(), storage, vpn), vpnCredential(r.Context(), storage, vpn))
		// Distinguished in the trail: "start" and "the container was gone and
		// got rebuilt" are different events, and on a host that prunes
		// stopped containers the second is worth being able to count.
		detail := ""
		if rebuilt {
			detail = "container was missing -- rebuilt from stored config"
		}
		auditLog.Log(r.Context(), "vpn.docker.start", "vpn", vpn.ID, vpn.Name, detail)
		writeJSON(w, http.StatusOK, result)
	}))

	mux.HandleFunc("POST /api/vpns/{id}/docker/stop", protected(authMgr, sealMgr, func(w http.ResponseWriter, r *http.Request) {
		vpn, ok := findVpn(r.Context(), storage, r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "vpn not found")
			return
		}
		if !canAccessVpn(r.Context(), storage, vpn) {
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
		if !canAccessVpn(r.Context(), storage, vpn) {
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
		if !canAccessVpn(r.Context(), storage, vpn) {
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
		if !canAccessVpn(r.Context(), storage, vpn) {
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
		if !canAccessVpn(r.Context(), storage, vpn) {
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
