package main

import (
	"testing"
	"time"
)

// Representative output of metricsCommand from a 4-core box.
const sampleMetricsOutput = `STAT1 cpu  1000 20 300 8000 100 0 30 0 0 0
STAT2 cpu  1100 20 350 8700 110 0 30 0 0 0
CORES 4
LOAD 0.42 0.31 0.28 1/312 90210
UPTIME 1048576.42
MEM MemTotal:        8123456 kB
MEM MemFree:          812345 kB
MEM MemAvailable:    3123456 kB
MEM Buffers:          123456 kB
MEM Cached:          2123456 kB
DISK /dev/sda1 52428800 49283072 3145728 94% /
`

func TestParseHostMetrics(t *testing.T) {
	var m HostMetrics
	parseHostMetrics(sampleMetricsOutput, &m)

	if m.CPUCores != 4 {
		t.Errorf("cores: got %d, want 4", m.CPUCores)
	}
	// total delta 860, of which idle+iowait moved 710 -> 150/860 busy
	if m.CPUPercent < 17.3 || m.CPUPercent > 17.5 {
		t.Errorf("cpu: got %v, want ~17.4", m.CPUPercent)
	}
	if m.Load1 != 0.42 || m.Load15 != 0.28 {
		t.Errorf("load: got %v/%v, want 0.42/0.28", m.Load1, m.Load15)
	}
	if m.UptimeSec != 1048576 {
		t.Errorf("uptime: got %d, want 1048576", m.UptimeSec)
	}
	if m.MemTotalKB != 8123456 {
		t.Errorf("mem total: got %d", m.MemTotalKB)
	}
	// used = total - available
	if m.MemUsedKB != 8123456-3123456 {
		t.Errorf("mem used: got %d, want %d", m.MemUsedKB, 8123456-3123456)
	}
	if m.MemPercent < 61.5 || m.MemPercent > 61.6 {
		t.Errorf("mem pct: got %v, want ~61.6", m.MemPercent)
	}
	if m.DiskTotalKB != 52428800 || m.DiskUsedKB != 49283072 {
		t.Errorf("disk: got %d/%d", m.DiskUsedKB, m.DiskTotalKB)
	}
	if m.DiskPercent < 93.9 || m.DiskPercent > 94.1 {
		t.Errorf("disk pct: got %v, want ~94", m.DiskPercent)
	}
}

func TestParseHostMetricsFallsBackWithoutMemAvailable(t *testing.T) {
	out := `MEM MemTotal:        1000000 kB
MEM MemFree:          200000 kB
MEM Buffers:          100000 kB
MEM Cached:           300000 kB
`
	var m HostMetrics
	parseHostMetrics(out, &m)
	if m.MemUsedKB != 400000 {
		t.Fatalf("used: got %d, want 400000", m.MemUsedKB)
	}
	if m.MemPercent != 40 {
		t.Fatalf("pct: got %v, want 40", m.MemPercent)
	}
}

func TestParseHostMetricsToleratesMissingLines(t *testing.T) {
	// A host where /proc/stat isn't readable still reports disk and memory
	// rather than failing the whole reading.
	var m HostMetrics
	parseHostMetrics("CORES 2\nDISK /dev/root 100 25 75 25% /\n", &m)
	if m.CPUPercent != 0 {
		t.Errorf("cpu: got %v, want 0", m.CPUPercent)
	}
	if m.DiskPercent != 25 {
		t.Errorf("disk pct: got %v, want 25", m.DiskPercent)
	}
}

func TestAppendSampleTrimsToWindow(t *testing.T) {
	now := time.Now()
	var history []MetricSample
	// One sample a minute for three hours; only the last hour must survive.
	for i := 180; i >= 0; i-- {
		history = appendSample(history, MetricSample{T: now.Add(-time.Duration(i) * time.Minute)})
	}
	if len(history) != 61 {
		t.Fatalf("len: got %d, want 61", len(history))
	}
	if history[0].T.Before(now.Add(-metricsHistoryWindow)) {
		t.Fatal("kept a sample older than the window")
	}
}

func TestAppendSampleCapsCount(t *testing.T) {
	now := time.Now()
	var history []MetricSample
	// A burst of samples all inside the window must still be capped.
	for i := 0; i < metricsHistoryMax*2; i++ {
		history = appendSample(history, MetricSample{T: now.Add(time.Duration(i) * time.Millisecond)})
	}
	if len(history) != metricsHistoryMax {
		t.Fatalf("len: got %d, want %d", len(history), metricsHistoryMax)
	}
}
