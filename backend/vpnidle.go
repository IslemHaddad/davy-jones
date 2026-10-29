package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

// maxIdleTimeoutMinutes caps Vpn.IdleTimeoutMinutes at one week.
const maxIdleTimeoutMinutes = 7 * 24 * 60

// VpnIdleTracker records when each VPN was last used, so the idle sweep can
// stop a tunnel nobody needs any more.
//
// "Used" means something a person did through the tunnel: an SSH command,
// an open shell, or a saved command on a host behind the VPN, service
// discovery there, or Start/Ping/Nc on the VPN itself. The background polls
// the open dashboard makes on its own (ping, metrics, service status, docker
// status) deliberately don't count -- otherwise leaving a browser tab open
// would keep every tunnel up forever.
type VpnIdleTracker struct {
	mu       sync.Mutex
	lastUsed map[string]time.Time
	// active counts open shells/streamed commands per VPN. A shell that sits
	// quietly at a prompt is still in use, so a VPN with one open is never
	// idle, however long since the last keystroke reached the tracker.
	active map[string]int
}

func NewVpnIdleTracker() *VpnIdleTracker {
	return &VpnIdleTracker{lastUsed: map[string]time.Time{}, active: map[string]int{}}
}

// Touch marks the VPN as used now. An empty id (a host not behind any VPN)
// is a no-op, so callers can pass host.VpnID unconditionally.
func (t *VpnIdleTracker) Touch(vpnID string) {
	if vpnID == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastUsed[vpnID] = time.Now()
}

// Hold marks the VPN in use until the returned release is called -- for the
// lifetime of a terminal session.
func (t *VpnIdleTracker) Hold(vpnID string) (release func()) {
	if vpnID == "" {
		return func() {}
	}
	t.mu.Lock()
	t.active[vpnID]++
	t.lastUsed[vpnID] = time.Now()
	t.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			t.mu.Lock()
			defer t.mu.Unlock()
			if t.active[vpnID]--; t.active[vpnID] <= 0 {
				delete(t.active, vpnID)
			}
			// The idle clock starts when the last shell closes, not when it
			// opened.
			t.lastUsed[vpnID] = time.Now()
		})
	}
}

// idleFor reports how long the VPN has gone unused, and false if it is in
// use right now. A VPN never seen before starts its clock at first sight
// (after a server restart, say) rather than counting as idle since forever,
// which would stop every running tunnel on the first sweep.
func (t *VpnIdleTracker) idleFor(vpnID string, now time.Time) (time.Duration, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.active[vpnID] > 0 {
		return 0, false
	}
	last, ok := t.lastUsed[vpnID]
	if !ok {
		t.lastUsed[vpnID] = now
		return 0, true
	}
	return now.Sub(last), true
}

// idleVpnDue reports whether a VPN with this config and idle time should be
// stopped.
func idleVpnDue(v Vpn, idle time.Duration) bool {
	if v.IdleTimeoutMinutes <= 0 || strings.TrimSpace(v.ContainerName) == "" {
		return false
	}
	return idle >= time.Duration(v.IdleTimeoutMinutes)*time.Minute
}

// RunIdleSweep checks once a minute for VPNs that have gone unused past
// their idle timeout and stops their containers. While the server is sealed
// it can't read the VPN list, so it does nothing.
func (t *VpnIdleTracker) RunIdleSweep(storage *Storage, sealMgr *SealManager, auditLog *AuditLogger) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for now := range ticker.C {
		key, err := sealMgr.Key()
		if err != nil {
			continue
		}
		t.sweep(withSealKey(context.Background(), key), storage, auditLog, now)
	}
}

func (t *VpnIdleTracker) sweep(ctx context.Context, storage *Storage, auditLog *AuditLogger, now time.Time) {
	vpns, err := storage.GetVpns(ctx)
	if err != nil {
		log.Printf("vpn idle sweep: %v", err)
		return
	}
	for _, v := range vpns {
		idle, notInUse := t.idleFor(v.ID, now)
		if !notInUse || !idleVpnDue(v, idle) {
			continue
		}
		// Only a running container is stopped (and logged): one that is
		// already down, or missing, has nothing to time out.
		if status := DockerStatus(v); status.ExitCode != 0 || strings.TrimSpace(status.Stdout) != "running" {
			continue
		}
		result := DockerStop(v)
		detail := fmt.Sprintf("idle for %d min (timeout %d min)", int(idle.Minutes()), v.IdleTimeoutMinutes)
		if result.ExitCode != 0 || result.Error != "" {
			detail += "; stop failed: " + strings.TrimSpace(result.Error+" "+result.Stderr)
		}
		log.Printf("vpn %q: %s", v.Name, detail)
		auditLog.Log(ctx, "vpn.docker.idle_stop", "vpn", v.ID, v.Name, detail)
		// Restart the clock either way, so a stop that failed is retried one
		// timeout later instead of every minute.
		t.Touch(v.ID)
	}
}
