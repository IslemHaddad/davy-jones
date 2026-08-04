package main

import (
	"strconv"
	"strings"
	"sync"
	"time"
)

// HostMetrics is one point-in-time reading of a host's resource usage.
// Error is set (and the numbers left zero) when collection failed -- the
// host being unreachable is a normal, displayable state, not an API error.
type HostMetrics struct {
	HostID      string    `json:"hostId"`
	CollectedAt time.Time `json:"collectedAt"`
	CPUPercent  float64   `json:"cpuPercent"`
	CPUCores    int       `json:"cpuCores"`
	Load1       float64   `json:"load1"`
	Load5       float64   `json:"load5"`
	Load15      float64   `json:"load15"`
	MemUsedKB   int64     `json:"memUsedKb"`
	MemTotalKB  int64     `json:"memTotalKb"`
	MemPercent  float64   `json:"memPercent"`
	DiskUsedKB  int64     `json:"diskUsedKb"`
	DiskTotalKB int64     `json:"diskTotalKb"`
	DiskPercent float64   `json:"diskPercent"`
	UptimeSec   int64     `json:"uptimeSec"`
	Error       string    `json:"error,omitempty"`
}

// MetricSample is the trimmed-down form kept for history -- just the three
// percentages the sparklines draw, so an hour of samples stays tiny.
type MetricSample struct {
	T    time.Time `json:"t"`
	CPU  float64   `json:"cpu"`
	Mem  float64   `json:"mem"`
	Disk float64   `json:"disk"`
}

// HostMetricsResponse is what the API returns: the current reading plus the
// recent history behind it.
type HostMetricsResponse struct {
	HostMetrics
	History []MetricSample `json:"history"`
}

const (
	// Collection costs a full SSH connect, so readings are cached: several
	// browser tabs polling the same host share one connection per TTL.
	metricsCacheTTL = 20 * time.Second
	// History is in-memory only (lost on restart, by design -- see the
	// feature discussion): enough to answer "is this climbing or steady?"
	// without turning the data dir into a time-series database.
	metricsHistoryWindow = time.Hour
	metricsHistoryMax    = 256
	// Hosts nobody has looked at for this long get their history dropped,
	// which is also how entries for deleted hosts are reclaimed.
	metricsEntryIdleTTL = 2 * time.Hour
)

// metricsCommand reads everything in one round-trip. Values are labelled so
// parsing never depends on line order, and the two /proc/stat reads a second
// apart are what make a real CPU percentage possible (a single read only
// gives cumulative jiffies since boot, which is useless on its own).
const metricsCommand = `echo "STAT1 $(grep '^cpu ' /proc/stat)"
sleep 1
echo "STAT2 $(grep '^cpu ' /proc/stat)"
echo "CORES $(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo)"
echo "LOAD $(cat /proc/loadavg)"
echo "UPTIME $(cut -d' ' -f1 /proc/uptime)"
grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached):' /proc/meminfo | sed 's/^/MEM /'
echo "DISK $(df -Pk / | tail -1)"`

// MetricsCollector caches the latest reading and recent history per host.
type MetricsCollector struct {
	mu      sync.Mutex
	entries map[string]*hostMetricsEntry
}

type hostMetricsEntry struct {
	// Held across the SSH call on purpose: a second caller arriving mid
	// collection waits and gets the fresh reading instead of opening a
	// competing connection to the same box.
	mu      sync.Mutex
	latest  HostMetrics
	history []MetricSample
}

func NewMetricsCollector() *MetricsCollector {
	return &MetricsCollector{entries: map[string]*hostMetricsEntry{}}
}

func (c *MetricsCollector) entry(hostID string) *hostMetricsEntry {
	c.mu.Lock()
	defer c.mu.Unlock()

	cutoff := time.Now().Add(-metricsEntryIdleTTL)
	for id, e := range c.entries {
		if id != hostID && e.latest.CollectedAt.Before(cutoff) {
			delete(c.entries, id)
		}
	}

	e, ok := c.entries[hostID]
	if !ok {
		e = &hostMetricsEntry{}
		c.entries[hostID] = e
	}
	return e
}

// Get returns the host's metrics, collecting fresh ones over SSH if the
// cached reading has aged past the TTL.
func (c *MetricsCollector) Get(host Host, cred Credential) HostMetricsResponse {
	e := c.entry(host.ID)
	e.mu.Lock()
	defer e.mu.Unlock()

	if time.Since(e.latest.CollectedAt) >= metricsCacheTTL {
		m := collectHostMetrics(host, cred)
		e.latest = m
		if m.Error == "" {
			e.history = appendSample(e.history, MetricSample{
				T:    m.CollectedAt,
				CPU:  m.CPUPercent,
				Mem:  m.MemPercent,
				Disk: m.DiskPercent,
			})
		}
	}

	// Must be a non-nil slice: Go marshals a nil slice as `null`, and the
	// browser then calls .length on it and takes the panel down with it.
	history := make([]MetricSample, 0, len(e.history))
	history = append(history, e.history...)
	return HostMetricsResponse{HostMetrics: e.latest, History: history}
}

func appendSample(history []MetricSample, s MetricSample) []MetricSample {
	history = append(history, s)
	cutoff := s.T.Add(-metricsHistoryWindow)
	first := 0
	for first < len(history) && history[first].T.Before(cutoff) {
		first++
	}
	history = history[first:]
	if len(history) > metricsHistoryMax {
		history = history[len(history)-metricsHistoryMax:]
	}
	return history
}

func collectHostMetrics(host Host, cred Credential) HostMetrics {
	m := HostMetrics{HostID: host.ID, CollectedAt: time.Now()}

	result := RunSSHCommand(host, cred, metricsCommand)
	if result.Error != "" {
		m.Error = result.Error
		return m
	}
	if result.ExitCode != 0 {
		m.Error = strings.TrimSpace(result.Stderr)
		if m.Error == "" {
			m.Error = "metrics command exited " + strconv.Itoa(result.ExitCode)
		}
		return m
	}

	parseHostMetrics(result.Stdout, &m)
	if m.MemTotalKB == 0 && m.DiskTotalKB == 0 {
		m.Error = "could not read /proc on this host (not a Linux system?)"
	}
	return m
}

// parseHostMetrics fills m from the labelled output of metricsCommand. It is
// deliberately tolerant: a host missing any one line still reports the rest.
func parseHostMetrics(stdout string, m *HostMetrics) {
	var stat1, stat2 []float64
	mem := map[string]int64{}

	for _, line := range strings.Split(stdout, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "STAT1":
			stat1 = parseFloats(fields[2:]) // fields[1] is the "cpu" label
		case "STAT2":
			stat2 = parseFloats(fields[2:])
		case "CORES":
			m.CPUCores = int(parseInt(fields[1]))
		case "LOAD":
			loads := parseFloats(fields[1:])
			if len(loads) >= 3 {
				m.Load1, m.Load5, m.Load15 = loads[0], loads[1], loads[2]
			}
		case "UPTIME":
			m.UptimeSec = int64(parseFloat(fields[1]))
		case "MEM":
			// e.g. "MEM MemTotal: 8123456 kB"
			if len(fields) >= 3 {
				mem[strings.TrimSuffix(fields[1], ":")] = parseInt(fields[2])
			}
		case "DISK":
			// df -Pk: Filesystem 1024-blocks Used Available Capacity Mounted
			// Read from the end -- a filesystem name may contain spaces.
			if len(fields) >= 6 {
				tail := fields[len(fields)-5:]
				m.DiskTotalKB = parseInt(tail[0])
				m.DiskUsedKB = parseInt(tail[1])
			}
		}
	}

	m.CPUPercent = cpuPercent(stat1, stat2)

	m.MemTotalKB = mem["MemTotal"]
	if avail, ok := mem["MemAvailable"]; ok {
		m.MemUsedKB = m.MemTotalKB - avail
	} else {
		// Pre-3.14 kernels have no MemAvailable; free+buffers+cached is the
		// closest equivalent to "reclaimable".
		m.MemUsedKB = m.MemTotalKB - mem["MemFree"] - mem["Buffers"] - mem["Cached"]
	}
	if m.MemUsedKB < 0 {
		m.MemUsedKB = 0
	}
	m.MemPercent = percent(m.MemUsedKB, m.MemTotalKB)
	m.DiskPercent = percent(m.DiskUsedKB, m.DiskTotalKB)
}

// cpuPercent turns two /proc/stat readings into busy time as a percentage of
// elapsed time. Field order is user nice system idle iowait irq softirq...;
// idle and iowait both count as not-busy.
func cpuPercent(stat1, stat2 []float64) float64 {
	if len(stat1) < 5 || len(stat2) < 5 {
		return 0
	}
	var total1, total2 float64
	for _, v := range stat1 {
		total1 += v
	}
	for _, v := range stat2 {
		total2 += v
	}
	idle1 := stat1[3] + stat1[4]
	idle2 := stat2[3] + stat2[4]

	totalDelta := total2 - total1
	idleDelta := idle2 - idle1
	if totalDelta <= 0 {
		return 0
	}
	return clampPercent((totalDelta - idleDelta) / totalDelta * 100)
}

func percent(used, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return clampPercent(float64(used) / float64(total) * 100)
}

func clampPercent(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	// One decimal is all the UI shows; keep the JSON tidy.
	return float64(int(v*10+0.5)) / 10
}

func parseFloats(fields []string) []float64 {
	out := make([]float64, 0, len(fields))
	for _, f := range fields {
		out = append(out, parseFloat(f))
	}
	return out
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func parseInt(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}
