package main

import "net/http"

// Seal routes are intentionally public (no session, no unseal requirement):
// unsealing needs no authentication of its own -- possession of a threshold
// of key shares *is* the authorization, exactly like Vault. Everything else
// in the app (including logging in) sits behind this.
func registerSealRoutes(mux *http.ServeMux, sealMgr *SealManager) {
	mux.HandleFunc("GET /api/seal/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, sealMgr.Status())
	})

	mux.HandleFunc("POST /api/seal/initialize", func(w http.ResponseWriter, r *http.Request) {
		shares, err := sealMgr.Initialize(cfg.UnsealShares, cfg.UnsealThreshold)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"shares":      shares,
			"threshold":   cfg.UnsealThreshold,
			"totalShares": cfg.UnsealShares,
		})
	})

	mux.HandleFunc("POST /api/seal/unseal", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Share string `json:"share"`
		}
		if err := readJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		unsealed, err := sealMgr.SubmitShare(body.Share)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		status := sealMgr.Status()
		writeJSON(w, http.StatusOK, map[string]any{
			"unsealed":    unsealed,
			"initialized": status.Initialized,
			"sealed":      status.Sealed,
			"progress":    status.Progress,
			"threshold":   status.Threshold,
			"totalShares": status.TotalShares,
		})
	})
}
