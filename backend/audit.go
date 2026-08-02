package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// AuditEntry records one attributable action. Timestamp/UserID/Username are
// filled in by Log from context -- callers only supply what happened.
type AuditEntry struct {
	ID          string    `json:"id"`
	Timestamp   time.Time `json:"timestamp"`
	UserID      string    `json:"userId"`
	Username    string    `json:"username"`
	Action      string    `json:"action"`
	TargetType  string    `json:"targetType,omitempty"`
	TargetID    string    `json:"targetId,omitempty"`
	TargetLabel string    `json:"targetLabel,omitempty"`
	Detail      string    `json:"detail,omitempty"`
}

// AuditLogger is intentionally NOT built on Storage's readEncrypted/
// writeEncrypted: those decrypt-mutate-reencrypt the entire file on every
// write, which is fine for rarely-changing resource lists but a bad fit for
// a high-frequency append-only log (every SSH command would otherwise
// re-encrypt the full audit history). Instead each entry is its own
// AES-GCM-sealed line, appended to a per-day file -- one syscall, no read,
// no contention with Storage.mu.
type AuditLogger struct {
	mu      sync.Mutex
	dataDir string
}

func NewAuditLogger(dataDir string) *AuditLogger {
	return &AuditLogger{dataDir: dataDir}
}

func (a *AuditLogger) pathForDay(day time.Time) string {
	return filepath.Join(a.dataDir, fmt.Sprintf("audit-%s.ndjson", day.UTC().Format("2006-01-02")))
}

// Log records an event. It is best-effort: a missing identity, a sealed
// process, or a disk error all just get logged to stderr -- an audit
// failure must never block the real action it's describing.
func (a *AuditLogger) Log(ctx context.Context, action, targetType, targetID, targetLabel, detail string) {
	userID, username, ok := userFromContext(ctx)
	if !ok {
		userID, username = "", "system"
	}
	key, err := sealKeyFromContext(ctx)
	if err != nil {
		log.Printf("audit: skipping %q, sealed: %v", action, err)
		return
	}

	entry := AuditEntry{
		ID:          newID("audit"),
		Timestamp:   time.Now(),
		UserID:      userID,
		Username:    username,
		Action:      action,
		TargetType:  targetType,
		TargetID:    targetID,
		TargetLabel: targetLabel,
		Detail:      detail,
	}

	plain, err := json.Marshal(entry)
	if err != nil {
		log.Printf("audit: marshal %q: %v", action, err)
		return
	}
	cipherBytes, err := encryptWithKey(key, plain)
	if err != nil {
		log.Printf("audit: encrypt %q: %v", action, err)
		return
	}
	line := base64.StdEncoding.EncodeToString(cipherBytes) + "\n"

	a.mu.Lock()
	defer a.mu.Unlock()
	f, err := os.OpenFile(a.pathForDay(entry.Timestamp), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		log.Printf("audit: open log file for %q: %v", action, err)
		return
	}
	defer f.Close()
	if _, err := f.WriteString(line); err != nil {
		log.Printf("audit: write %q: %v", action, err)
	}
}

// AuditListOptions filters a List call. Zero values mean "unfiltered"
// except Since/Until, which default to the last 30 days.
type AuditListOptions struct {
	Limit        int
	UserID       string
	ActionPrefix string
	Since, Until time.Time
}

// List scans day-files covering [Since,Until], decrypts and filters each
// entry in memory, and returns the newest Limit entries. No index -- fine
// at the volume a local devops dashboard's audit trail sees.
func (a *AuditLogger) List(ctx context.Context, opts AuditListOptions) ([]AuditEntry, error) {
	key, err := sealKeyFromContext(ctx)
	if err != nil {
		return nil, err
	}

	until := opts.Until
	if until.IsZero() {
		until = time.Now()
	}
	since := opts.Since
	if since.IsZero() {
		since = until.AddDate(0, 0, -30)
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}

	var entries []AuditEntry
	for day := since; !day.After(until); day = day.AddDate(0, 0, 1) {
		path := a.pathForDay(day)
		f, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			cipherBytes, err := base64.StdEncoding.DecodeString(line)
			if err != nil {
				continue
			}
			plain, err := decryptWithKey(key, cipherBytes)
			if err != nil {
				continue
			}
			var entry AuditEntry
			if err := json.Unmarshal(plain, &entry); err != nil {
				continue
			}
			if opts.UserID != "" && entry.UserID != opts.UserID {
				continue
			}
			if opts.ActionPrefix != "" && !strings.HasPrefix(entry.Action, opts.ActionPrefix) {
				continue
			}
			entries = append(entries, entry)
		}
		f.Close()
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Timestamp.After(entries[j].Timestamp)
	})
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return entries, nil
}
