// monitor-master holds the check definitions (edited from its web UI),
// receives results from monitor-worker instances, and sends a webhook when a
// check flips between true and false or a worker stops reporting.
package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"davy-jones/monitor/internal/proto"
)

//go:embed ui
var uiFiles embed.FS

type config struct {
	Addr       string
	DataFile   string
	AdminToken string
	StaleAfter time.Duration
	TLSCert    string
	TLSKey     string
}

func loadConfig() config {
	c := config{
		Addr:       envOr("MON_ADDR", "0.0.0.0:9090"),
		DataFile:   envOr("MON_DATA_FILE", "/var/lib/monitor-master/state.json"),
		AdminToken: os.Getenv("MON_ADMIN_TOKEN"),
		StaleAfter: 3 * time.Minute,
		TLSCert:    os.Getenv("MON_TLS_CERT"),
		TLSKey:     os.Getenv("MON_TLS_KEY"),
	}
	if v := os.Getenv("MON_STALE_AFTER"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < 30*time.Second {
			log.Fatalf("MON_STALE_AFTER must be a duration of at least 30s, got %q", v)
		}
		c.StaleAfter = d
	}
	if len(c.AdminToken) < 16 {
		log.Fatal("MON_ADMIN_TOKEN must be set to at least 16 characters")
	}
	return c
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	cfg := loadConfig()
	store, err := OpenStore(cfg.DataFile)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	notifier := NewNotifier()

	go sweepSilentWorkers(store, notifier, cfg.StaleAfter)

	mux := http.NewServeMux()
	registerWorkerRoutes(mux, store, notifier)
	registerAdminRoutes(mux, store, notifier, cfg.AdminToken)

	sub, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		log.Printf("monitor-master listening on https://%s", cfg.Addr)
		log.Fatal(srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey))
	}
	log.Printf("monitor-master listening on http://%s", cfg.Addr)
	log.Fatal(srv.ListenAndServe())
}

// sweepSilentWorkers alerts once for each worker that stops reporting -- the
// case a worker can't report itself: the VM is down, unreachable, or the
// worker process died.
func sweepSilentWorkers(store *Store, n *Notifier, staleAfter time.Duration) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for now := range t.C {
		for _, w := range store.MarkSilentWorkers(now, staleAfter) {
			n.Send(store.WebhookURL(), workerEvent(EventWorkerSilent, w.Name, w.LastSeen))
		}
	}
}

// ---- worker API ----

func registerWorkerRoutes(mux *http.ServeMux, store *Store, n *Notifier) {
	auth := func(h func(http.ResponseWriter, *http.Request, Worker)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			worker, ok := store.AuthenticateWorker(bearerToken(r))
			if !ok {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			if store.TouchWorker(worker.ID, time.Now()) {
				n.Send(store.WebhookURL(), workerEvent(EventWorkerBack, worker.Name, time.Time{}))
			}
			h(w, r, worker)
		}
	}

	mux.HandleFunc("GET /api/worker/checks", auth(func(w http.ResponseWriter, r *http.Request, worker Worker) {
		writeJSON(w, http.StatusOK, proto.ChecksResponse{Checks: store.ChecksForWorker(worker.ID)})
	}))

	mux.HandleFunc("POST /api/worker/results", auth(func(w http.ResponseWriter, r *http.Request, worker Worker) {
		var body proto.ResultsRequest
		if err := readJSON(w, r, &body, 1<<20); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		for _, changed := range store.RecordResults(worker.ID, body.Results) {
			n.Send(store.WebhookURL(), checkEvent(changed, worker.Name))
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}

// ---- admin API (used by the UI) ----

func registerAdminRoutes(mux *http.ServeMux, store *Store, n *Notifier, adminToken string) {
	admin := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if subtle.ConstantTimeCompare([]byte(bearerToken(r)), []byte(adminToken)) != 1 {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			h(w, r)
		}
	}

	mux.HandleFunc("GET /api/admin/status", admin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.StatusRows())
	}))

	mux.HandleFunc("GET /api/admin/config", admin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.ExportConfig())
	}))

	mux.HandleFunc("GET /api/admin/settings", admin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"webhookUrl": store.WebhookURL()})
	}))

	mux.HandleFunc("PUT /api/admin/settings", admin(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			WebhookURL string `json:"webhookUrl"`
		}
		if err := readJSON(w, r, &body, 64<<10); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		if err := store.SetWebhookURL(body.WebhookURL); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"webhookUrl": store.WebhookURL()})
	}))

	mux.HandleFunc("POST /api/admin/settings/test", admin(func(w http.ResponseWriter, r *http.Request) {
		url := store.WebhookURL()
		if url == "" {
			writeError(w, http.StatusBadRequest, "no webhook URL configured")
			return
		}
		ev := Event{Event: EventTest, OK: true, Worker: "monitor-master", At: time.Now(),
			Text: "🔔 Test notification from monitor-master"}
		if err := n.Post(url, ev); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("GET /api/admin/workers", admin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.Workers())
	}))

	mux.HandleFunc("POST /api/admin/workers", admin(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := readJSON(w, r, &body, 64<<10); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		worker, token, err := store.CreateWorker(body.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"worker": worker, "token": token})
	}))

	mux.HandleFunc("POST /api/admin/workers/{id}/rotate", admin(func(w http.ResponseWriter, r *http.Request) {
		token, err := store.RotateWorkerToken(r.PathValue("id"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": token})
	}))

	mux.HandleFunc("DELETE /api/admin/workers/{id}", admin(func(w http.ResponseWriter, r *http.Request) {
		if err := store.DeleteWorker(r.PathValue("id")); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("GET /api/admin/checks", admin(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.Checks())
	}))

	mux.HandleFunc("POST /api/admin/checks", admin(func(w http.ResponseWriter, r *http.Request) {
		var c CheckDef
		if err := readJSON(w, r, &c, 64<<10); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		created, err := store.CreateCheck(c)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)
	}))

	mux.HandleFunc("PUT /api/admin/checks/{id}", admin(func(w http.ResponseWriter, r *http.Request) {
		var c CheckDef
		if err := readJSON(w, r, &c, 64<<10); err != nil {
			writeError(w, http.StatusBadRequest, "invalid body")
			return
		}
		updated, err := store.UpdateCheck(r.PathValue("id"), c)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, updated)
	}))

	mux.HandleFunc("DELETE /api/admin/checks/{id}", admin(func(w http.ResponseWriter, r *http.Request) {
		if err := store.DeleteCheck(r.PathValue("id")); err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
}

// ---- helpers ----

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, prefix) {
		return strings.TrimPrefix(h, prefix)
	}
	return ""
}

func readJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeError(w, http.StatusBadRequest, err.Error())
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		head := w.Header()
		head.Set("X-Content-Type-Options", "nosniff")
		head.Set("X-Frame-Options", "DENY")
		head.Set("Referrer-Policy", "no-referrer")
		head.Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		h.ServeHTTP(w, r)
	})
}
