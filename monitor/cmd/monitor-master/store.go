package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"davy-jones/monitor/internal/proto"
)

// Worker is one VM running monitor-worker. Only a hash of its token is kept:
// the plaintext is shown once, when the worker is created or rotated.
type Worker struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	TokenHash string    `json:"tokenHash"`
	CreatedAt time.Time `json:"createdAt"`
	LastSeen  time.Time `json:"lastSeen"`
	// Silent is set once the worker has missed its heartbeat window and the
	// "worker_silent" alert has gone out, so it isn't re-sent every sweep.
	Silent bool `json:"silent"`
}

// CheckDef is a check as defined from the UI: which worker runs it, the
// command, and how often.
type CheckDef struct {
	ID              string    `json:"id"`
	WorkerID        string    `json:"workerId"`
	Name            string    `json:"name"`
	Command         string    `json:"command"`
	IntervalSeconds int       `json:"intervalSeconds"`
	TimeoutSeconds  int       `json:"timeoutSeconds"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"createdAt"`
}

// CheckStatus is the last known outcome of a check. Known is false until
// the first result arrives, which is how the first run is told apart from a
// state change.
type CheckStatus struct {
	Known      bool      `json:"known"`
	OK         bool      `json:"ok"`
	ExitCode   int       `json:"exitCode"`
	Output     string    `json:"output"`
	DurationMs int64     `json:"durationMs"`
	LastRun    time.Time `json:"lastRun"`
	// Since is when the check entered its current OK/failing state.
	Since time.Time `json:"since"`
}

// State is the whole persisted JSON document.
type State struct {
	WebhookURL string                 `json:"webhookUrl"`
	Workers    []Worker               `json:"workers"`
	Checks     []CheckDef             `json:"checks"`
	Status     map[string]CheckStatus `json:"status"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	state State
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, state: State{Status: map[string]CheckStatus{}}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &s.state); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if s.state.Status == nil {
		s.state.Status = map[string]CheckStatus{}
	}
	return s, nil
}

// save writes the state atomically (temp file + rename), so a crash mid-write
// can't leave a truncated JSON file behind. Caller holds s.mu.
func (s *Store) save() error {
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// ---- settings ----

func (s *Store) WebhookURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.WebhookURL
}

func validateWebhookURL(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("webhook URL must be an http(s) URL")
	}
	return nil
}

func (s *Store) SetWebhookURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if err := validateWebhookURL(raw); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.WebhookURL = raw
	return s.save()
}

// ---- workers ----

// WorkerView is a Worker without its token hash, for the admin API.
type WorkerView struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	LastSeen  time.Time `json:"lastSeen"`
	Silent    bool      `json:"silent"`
}

func viewWorker(w Worker) WorkerView {
	return WorkerView{ID: w.ID, Name: w.Name, CreatedAt: w.CreatedAt, LastSeen: w.LastSeen, Silent: w.Silent}
}

func (s *Store) Workers() []WorkerView {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]WorkerView, 0, len(s.state.Workers))
	for _, w := range s.state.Workers {
		out = append(out, viewWorker(w))
	}
	return out
}

func validateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("name is required")
	}
	if len(name) > 100 {
		return "", errors.New("name must be at most 100 characters")
	}
	return name, nil
}

// CreateWorker returns the new worker and its plaintext token, which is
// never retrievable again.
func (s *Store) CreateWorker(name string) (WorkerView, string, error) {
	name, err := validateName(name)
	if err != nil {
		return WorkerView{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.state.Workers {
		if strings.EqualFold(w.Name, name) {
			return WorkerView{}, "", errors.New("a worker with that name already exists")
		}
	}
	token := newToken()
	w := Worker{ID: newID("worker"), Name: name, TokenHash: hashToken(token), CreatedAt: time.Now()}
	s.state.Workers = append(s.state.Workers, w)
	if err := s.save(); err != nil {
		return WorkerView{}, "", err
	}
	return viewWorker(w), token, nil
}

func (s *Store) RotateWorkerToken(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Workers {
		if s.state.Workers[i].ID == id {
			token := newToken()
			s.state.Workers[i].TokenHash = hashToken(token)
			return token, s.save()
		}
	}
	return "", errNotFound
}

// DeleteWorker removes the worker and every check assigned to it.
func (s *Store) DeleteWorker(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	found := false
	workers := s.state.Workers[:0]
	for _, w := range s.state.Workers {
		if w.ID == id {
			found = true
			continue
		}
		workers = append(workers, w)
	}
	if !found {
		return errNotFound
	}
	s.state.Workers = workers
	checks := s.state.Checks[:0]
	for _, c := range s.state.Checks {
		if c.WorkerID == id {
			delete(s.state.Status, c.ID)
			continue
		}
		checks = append(checks, c)
	}
	s.state.Checks = checks
	return s.save()
}

// AuthenticateWorker resolves a bearer token to a worker. Every stored hash
// is compared in constant time, so timing doesn't reveal a partial match.
func (s *Store) AuthenticateWorker(token string) (Worker, bool) {
	if token == "" {
		return Worker{}, false
	}
	h := []byte(hashToken(token))
	s.mu.Lock()
	defer s.mu.Unlock()
	var match Worker
	ok := false
	for _, w := range s.state.Workers {
		if subtle.ConstantTimeCompare(h, []byte(w.TokenHash)) == 1 {
			match, ok = w, true
		}
	}
	return match, ok
}

// TouchWorker records a heartbeat. It reports whether the worker was marked
// silent, so the caller can send the "back" notification.
func (s *Store) TouchWorker(id string, now time.Time) (wasSilent bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Workers {
		if s.state.Workers[i].ID == id {
			wasSilent = s.state.Workers[i].Silent
			s.state.Workers[i].LastSeen = now
			s.state.Workers[i].Silent = false
			_ = s.save()
			return wasSilent
		}
	}
	return false
}

// MarkSilentWorkers flags every worker that has enabled checks, has reported
// at least once, and hasn't been heard from within staleAfter. Only workers
// that newly went silent are returned, so each gets one alert.
func (s *Store) MarkSilentWorkers(now time.Time, staleAfter time.Duration) []Worker {
	s.mu.Lock()
	defer s.mu.Unlock()
	hasChecks := map[string]bool{}
	for _, c := range s.state.Checks {
		if c.Enabled {
			hasChecks[c.WorkerID] = true
		}
	}
	var silenced []Worker
	for i := range s.state.Workers {
		w := &s.state.Workers[i]
		if w.Silent || w.LastSeen.IsZero() || !hasChecks[w.ID] {
			continue
		}
		if now.Sub(w.LastSeen) > staleAfter {
			w.Silent = true
			silenced = append(silenced, *w)
		}
	}
	if len(silenced) > 0 {
		_ = s.save()
	}
	return silenced
}

// ---- checks ----

var errNotFound = errors.New("not found")

func (s *Store) Checks() []CheckDef {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]CheckDef{}, s.state.Checks...)
}

func (s *Store) workerExists(id string) bool {
	for _, w := range s.state.Workers {
		if w.ID == id {
			return true
		}
	}
	return false
}

func validateCheck(c *CheckDef) error {
	name, err := validateName(c.Name)
	if err != nil {
		return err
	}
	c.Name = name
	c.Command = strings.TrimSpace(c.Command)
	if c.Command == "" {
		return errors.New("command is required")
	}
	if len(c.Command) > 4096 {
		return errors.New("command must be at most 4096 characters")
	}
	if c.IntervalSeconds == 0 {
		c.IntervalSeconds = 60
	}
	if c.IntervalSeconds < 10 || c.IntervalSeconds > 86400 {
		return errors.New("interval must be between 10 and 86400 seconds")
	}
	if c.TimeoutSeconds == 0 {
		c.TimeoutSeconds = 30
	}
	if c.TimeoutSeconds < 1 || c.TimeoutSeconds > 3600 {
		return errors.New("timeout must be between 1 and 3600 seconds")
	}
	return nil
}

func (s *Store) CreateCheck(c CheckDef) (CheckDef, error) {
	if err := validateCheck(&c); err != nil {
		return CheckDef{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.workerExists(c.WorkerID) {
		return CheckDef{}, errors.New("worker not found")
	}
	c.ID = newID("check")
	c.CreatedAt = time.Now()
	s.state.Checks = append(s.state.Checks, c)
	return c, s.save()
}

func (s *Store) UpdateCheck(id string, c CheckDef) (CheckDef, error) {
	if err := validateCheck(&c); err != nil {
		return CheckDef{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.workerExists(c.WorkerID) {
		return CheckDef{}, errors.New("worker not found")
	}
	for i := range s.state.Checks {
		if s.state.Checks[i].ID == id {
			prev := s.state.Checks[i]
			c.ID = id
			c.CreatedAt = prev.CreatedAt
			s.state.Checks[i] = c
			// A different command or worker is a different check: its old
			// result says nothing about the new one.
			if prev.Command != c.Command || prev.WorkerID != c.WorkerID {
				delete(s.state.Status, id)
			}
			return c, s.save()
		}
	}
	return CheckDef{}, errNotFound
}

func (s *Store) DeleteCheck(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.state.Checks[:0]
	found := false
	for _, c := range s.state.Checks {
		if c.ID == id {
			found = true
			continue
		}
		out = append(out, c)
	}
	if !found {
		return errNotFound
	}
	s.state.Checks = out
	delete(s.state.Status, id)
	return s.save()
}

// ChecksForWorker is what a worker is told to run: its enabled checks only.
func (s *Store) ChecksForWorker(workerID string) []proto.Check {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []proto.Check{}
	for _, c := range s.state.Checks {
		if c.WorkerID == workerID && c.Enabled {
			out = append(out, proto.Check{
				ID:              c.ID,
				Name:            c.Name,
				Command:         c.Command,
				IntervalSeconds: c.IntervalSeconds,
				TimeoutSeconds:  c.TimeoutSeconds,
			})
		}
	}
	return out
}

// ---- results ----

// Transition names the notification a new result calls for, or "" for none.
// Only changes notify: a check that keeps failing alerts once, not on every
// run. The very first result alerts only if it failed -- a check that starts
// out healthy has nothing to report.
func Transition(prev CheckStatus, ok bool) string {
	switch {
	case !prev.Known && !ok:
		return EventCheckFailed
	case !prev.Known:
		return ""
	case prev.OK && !ok:
		return EventCheckFailed
	case !prev.OK && ok:
		return EventCheckRecovered
	}
	return ""
}

// RecordedResult is a result the store accepted, with what it means.
type RecordedResult struct {
	Check  CheckDef
	Result proto.Result
	Event  string
}

// RecordResults stores a worker's results and returns those that changed
// state. Results for checks that aren't this worker's (or no longer exist)
// are dropped: a worker can only report on its own checks.
func (s *Store) RecordResults(workerID string, results []proto.Result) []RecordedResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	byID := map[string]CheckDef{}
	for _, c := range s.state.Checks {
		if c.WorkerID == workerID {
			byID[c.ID] = c
		}
	}
	var changed []RecordedResult
	for _, r := range results {
		c, ok := byID[r.CheckID]
		if !ok {
			continue
		}
		if len(r.Output) > proto.MaxOutputBytes {
			r.Output = r.Output[:proto.MaxOutputBytes]
		}
		healthy := r.ExitCode == 0
		prev := s.state.Status[c.ID]
		event := Transition(prev, healthy)
		next := CheckStatus{
			Known:      true,
			OK:         healthy,
			ExitCode:   r.ExitCode,
			Output:     r.Output,
			DurationMs: r.DurationMs,
			LastRun:    r.RanAt,
			Since:      prev.Since,
		}
		if !prev.Known || prev.OK != healthy {
			next.Since = r.RanAt
		}
		s.state.Status[c.ID] = next
		if event != "" {
			changed = append(changed, RecordedResult{Check: c, Result: r, Event: event})
		}
	}
	_ = s.save()
	return changed
}

// StatusRow joins a check with its worker and last result, for the UI.
type StatusRow struct {
	Check      CheckDef    `json:"check"`
	WorkerName string      `json:"workerName"`
	Status     CheckStatus `json:"status"`
}

func (s *Store) StatusRows() []StatusRow {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := map[string]string{}
	for _, w := range s.state.Workers {
		names[w.ID] = w.Name
	}
	out := make([]StatusRow, 0, len(s.state.Checks))
	for _, c := range s.state.Checks {
		out = append(out, StatusRow{Check: c, WorkerName: names[c.WorkerID], Status: s.state.Status[c.ID]})
	}
	return out
}

func (s *Store) WorkerName(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.state.Workers {
		if w.ID == id {
			return w.Name
		}
	}
	return id
}

// ExportConfig is the check configuration as JSON, without token hashes or
// run state -- what the UI shows under "Config JSON".
func (s *Store) ExportConfig() any {
	s.mu.Lock()
	defer s.mu.Unlock()
	workers := make([]WorkerView, 0, len(s.state.Workers))
	for _, w := range s.state.Workers {
		workers = append(workers, viewWorker(w))
	}
	return map[string]any{
		"webhookUrl": s.state.WebhookURL,
		"workers":    workers,
		"checks":     append([]CheckDef{}, s.state.Checks...),
	}
}
