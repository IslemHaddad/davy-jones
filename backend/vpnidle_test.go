package main

import (
	"context"
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestIdleTrackerHoldBlocksIdle(t *testing.T) {
	tr := NewVpnIdleTracker()
	now := time.Now()

	// First sight starts the clock instead of counting as idle forever.
	if idle, ok := tr.idleFor("vpn_a", now); !ok || idle != 0 {
		t.Fatalf("first sight: idle=%s ok=%v", idle, ok)
	}
	if idle, _ := tr.idleFor("vpn_a", now.Add(10*time.Minute)); idle != 10*time.Minute {
		t.Fatalf("idle after 10m = %s", idle)
	}

	release := tr.Hold("vpn_a")
	if _, ok := tr.idleFor("vpn_a", now.Add(time.Hour)); ok {
		t.Fatal("VPN with an open shell reported as idle")
	}
	release()
	release() // a second release must not drive the count negative
	if _, ok := tr.idleFor("vpn_a", time.Now()); !ok {
		t.Fatal("VPN still held after release")
	}
	other := tr.Hold("vpn_a")
	defer other()
	if _, ok := tr.idleFor("vpn_a", time.Now()); ok {
		t.Fatal("double release broke the hold count")
	}

	tr.Touch("") // hosts with no VPN: must not panic or create an entry
	tr.Hold("")()
}

func TestIdleVpnDue(t *testing.T) {
	v := Vpn{ContainerName: "c", IdleTimeoutMinutes: 30}
	if idleVpnDue(v, 29*time.Minute) {
		t.Error("due before the timeout")
	}
	if !idleVpnDue(v, 30*time.Minute) {
		t.Error("not due at the timeout")
	}
	if idleVpnDue(Vpn{ContainerName: "c"}, 24*time.Hour) {
		t.Error("timeout 0 must never stop")
	}
	if idleVpnDue(Vpn{IdleTimeoutMinutes: 1}, time.Hour) {
		t.Error("VPN without a container name must not be stopped")
	}
}

// TestIdleSweepStopsOnlyIdleRunningVpns runs the sweep against a fake docker
// binary that reports every container as running and records stop calls.
func TestIdleSweepStopsOnlyIdleRunningVpns(t *testing.T) {
	dir := t.TempDir()
	stops := filepath.Join(dir, "stops")
	fake := filepath.Join(dir, "docker")
	script := "#!/bin/sh\n" +
		"case \"$1\" in\n" +
		"  inspect) echo running ;;\n" +
		"  stop) echo \"$2\" >> " + stops + " ;;\n" +
		"esac\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	prev := cfg
	t.Cleanup(func() { cfg = prev })
	cfg.DockerBin = fake
	cfg.DockerTimeout = 5 * time.Second

	storage, err := NewStorage(dir)
	if err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	ctx := withSealKey(context.Background(), key)
	vpns := []Vpn{
		{ID: "idle", Name: "idle", ContainerName: "c-idle", IdleTimeoutMinutes: 30},
		{ID: "busy", Name: "busy", ContainerName: "c-busy", IdleTimeoutMinutes: 30},
		{ID: "shell", Name: "shell", ContainerName: "c-shell", IdleTimeoutMinutes: 30},
		{ID: "never", Name: "never", ContainerName: "c-never"},
	}
	if err := storage.SaveVpns(ctx, vpns); err != nil {
		t.Fatal(err)
	}

	tr := NewVpnIdleTracker()
	start := time.Now()
	for _, v := range vpns {
		tr.idleFor(v.ID, start) // all first seen at start
	}
	defer tr.Hold("shell")()
	sweepAt := start.Add(31 * time.Minute)
	tr.lastUsed["busy"] = sweepAt.Add(-5 * time.Minute) // used 5 minutes before the sweep

	tr.sweep(ctx, storage, NewAuditLogger(dir), sweepAt)

	data, _ := os.ReadFile(stops)
	got := strings.Fields(string(data))
	if len(got) != 1 || got[0] != "c-idle" {
		t.Fatalf("stopped %v, want only [c-idle]", got)
	}
}
