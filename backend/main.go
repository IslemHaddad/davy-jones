package main

import (
	"log"
	"net"
	"net/http"
	"strconv"
	"time"
)

// cfg holds the resolved runtime configuration (env-overridable defaults),
// loaded once at startup and read by ssh.go / tcpping.go / docker.go.
var cfg Config

func main() {
	cfg = loadConfig()
	log.Printf("data dir: %s", cfg.DataDir)

	storage, err := NewStorage(cfg.DataDir)
	if err != nil {
		log.Fatalf("failed to init storage: %v", err)
	}
	authMgr := NewAuthManager(storage, cfg.SessionTTL)
	sealMgr, err := NewSealManager(storage)
	if err != nil {
		log.Fatalf("failed to init seal manager: %v", err)
	}
	if sealMgr.Status().Initialized {
		log.Printf("sealed: waiting for %d of %d key shares", sealMgr.Status().Threshold, sealMgr.Status().TotalShares)
	} else {
		log.Printf("not yet initialized: POST /api/seal/initialize to generate key shares")
	}
	auditLog := NewAuditLogger(cfg.DataDir)

	mux := http.NewServeMux()
	registerSealRoutes(mux, sealMgr)
	registerAuthRoutes(mux, authMgr, sealMgr, auditLog)
	registerUserRoutes(mux, authMgr, sealMgr, auditLog)
	registerProjectRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerConfigRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerSSHRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerMetricsRoutes(mux, storage, authMgr, sealMgr, NewMetricsCollector())
	registerLayoutRoutes(mux, storage, authMgr, sealMgr)
	registerDiscoveryRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerVPNRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerSavedCommandRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerTerminalRoutes(mux, storage, authMgr, sealMgr, auditLog)
	registerAuditRoutes(mux, auditLog, authMgr, sealMgr)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	// Anything not matched above (i.e. not /api/* or /health) is the
	// embedded React build, served with SPA fallback to index.html.
	mux.Handle("/", staticHandler())

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	log.Printf("listening on http://%s", addr)
	// Timeouts are set explicitly because http.ListenAndServe's zero-value
	// server has none: a client that opens a connection and never finishes
	// its request would otherwise hold a goroutine indefinitely. WriteTimeout
	// stays off -- the terminal WebSocket and metrics streams are long-lived
	// by design and a write deadline would kill them mid-session.
	srv := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
