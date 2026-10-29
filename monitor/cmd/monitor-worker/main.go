// monitor-worker runs on each monitored VM. It fetches its checks from
// monitor-master, runs each one on its interval, and reports the exit codes
// back. It only makes outbound requests and never listens on a port.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"davy-jones/monitor/internal/proto"
)

type options struct {
	master      string
	token       string
	poll        time.Duration
	once        bool
	maxParallel int
}

func parseOptions() options {
	var o options
	var tokenFile string
	flag.StringVar(&o.master, "master", os.Getenv("MON_MASTER_URL"), "monitor-master base URL, e.g. https://monitor.internal:9090 (env MON_MASTER_URL)")
	flag.StringVar(&tokenFile, "token-file", envOr("MON_WORKER_TOKEN_FILE", "/etc/monitor-worker/token"), "file holding this worker's token (env MON_WORKER_TOKEN_FILE)")
	flag.DurationVar(&o.poll, "poll", 30*time.Second, "how often to fetch checks and send a heartbeat")
	flag.BoolVar(&o.once, "once", false, "run every check once, report, and exit (for cron)")
	flag.IntVar(&o.maxParallel, "max-parallel", 4, "maximum checks running at the same time")
	flag.Parse()

	o.master = strings.TrimRight(o.master, "/")
	if o.master == "" {
		log.Fatal("-master (or MON_MASTER_URL) is required")
	}
	// The token comes from a file or the environment, never a flag: argv is
	// readable by every user on the VM through /proc.
	o.token = strings.TrimSpace(os.Getenv("MON_WORKER_TOKEN"))
	if o.token == "" {
		data, err := os.ReadFile(tokenFile)
		if err != nil {
			log.Fatalf("read token: %v", err)
		}
		o.token = strings.TrimSpace(string(data))
	}
	if o.token == "" {
		log.Fatal("worker token is empty")
	}
	if o.poll < 5*time.Second {
		o.poll = 5 * time.Second
	}
	if o.maxParallel < 1 {
		o.maxParallel = 1
	}
	return o
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type client struct {
	base  string
	token string
	http  *http.Client
}

func (c *client) do(ctx context.Context, method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s %s: %s %s", method, path, resp.Status, strings.TrimSpace(string(msg)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func (c *client) fetchChecks(ctx context.Context) ([]proto.Check, error) {
	var res proto.ChecksResponse
	err := c.do(ctx, http.MethodGet, "/api/worker/checks", nil, &res)
	return res.Checks, err
}

func (c *client) report(ctx context.Context, results []proto.Result) error {
	return c.do(ctx, http.MethodPost, "/api/worker/results", proto.ResultsRequest{Results: results}, nil)
}

func main() {
	opts := parseOptions()
	c := &client{base: opts.master, token: opts.token, http: &http.Client{Timeout: 15 * time.Second}}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if opts.once {
		if err := runOnce(ctx, c, opts.maxParallel); err != nil {
			log.Fatal(err)
		}
		return
	}
	log.Printf("monitor-worker started, master %s, poll %s", opts.master, opts.poll)
	newScheduler(c, opts).run(ctx)
}

// runOnce is the cron mode: every enabled check runs once, regardless of its
// interval -- cron's own schedule decides how often.
func runOnce(ctx context.Context, c *client, maxParallel int) error {
	checks, err := c.fetchChecks(ctx)
	if err != nil {
		return fmt.Errorf("fetch checks: %w", err)
	}
	results := make([]proto.Result, len(checks))
	sem := make(chan struct{}, maxParallel)
	var wg sync.WaitGroup
	for i, chk := range checks {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, chk proto.Check) {
			defer wg.Done()
			defer func() { <-sem }()
			results[i] = RunCheck(ctx, chk)
		}(i, chk)
	}
	wg.Wait()
	if len(results) == 0 {
		return nil
	}
	return c.report(ctx, results)
}

// scheduler is the daemon mode: it refreshes the check list every poll,
// runs each check when its interval is due, and reports results as they
// finish. Results that fail to send are kept and retried, so a master
// restart doesn't lose them.
type scheduler struct {
	c       *client
	opts    options
	mu      sync.Mutex
	checks  map[string]proto.Check
	nextRun map[string]time.Time
	running map[string]bool
	pending []proto.Result
	sem     chan struct{}
}

const maxPending = 500

func newScheduler(c *client, opts options) *scheduler {
	return &scheduler{
		c:       c,
		opts:    opts,
		checks:  map[string]proto.Check{},
		nextRun: map[string]time.Time{},
		running: map[string]bool{},
		sem:     make(chan struct{}, opts.maxParallel),
	}
}

func (s *scheduler) run(ctx context.Context) {
	s.refresh(ctx)
	pollTick := time.NewTicker(s.opts.poll)
	defer pollTick.Stop()
	runTick := time.NewTicker(time.Second)
	defer runTick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-pollTick.C:
			s.refresh(ctx)
			s.flush(ctx)
		case now := <-runTick.C:
			s.startDue(ctx, now)
		}
	}
}

// refresh doubles as the heartbeat: the master marks a worker silent when
// these requests stop arriving.
func (s *scheduler) refresh(ctx context.Context) {
	checks, err := s.c.fetchChecks(ctx)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("fetch checks (keeping the last known list): %v", err)
		}
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := map[string]proto.Check{}
	for _, chk := range checks {
		prev, existed := s.checks[chk.ID]
		next[chk.ID] = chk
		// A new check, or one whose command or interval changed, runs right
		// away instead of waiting out the old schedule.
		if !existed || prev.Command != chk.Command || prev.IntervalSeconds != chk.IntervalSeconds {
			s.nextRun[chk.ID] = time.Time{}
		}
	}
	for id := range s.nextRun {
		if _, ok := next[id]; !ok {
			delete(s.nextRun, id)
		}
	}
	s.checks = next
}

func (s *scheduler) startDue(ctx context.Context, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, chk := range s.checks {
		if s.running[id] || now.Before(s.nextRun[id]) {
			continue
		}
		s.running[id] = true
		s.nextRun[id] = now.Add(time.Duration(chk.IntervalSeconds) * time.Second)
		go s.execute(ctx, chk)
	}
}

func (s *scheduler) execute(ctx context.Context, chk proto.Check) {
	select {
	case s.sem <- struct{}{}:
	case <-ctx.Done():
		return
	}
	res := RunCheck(ctx, chk)
	<-s.sem

	s.mu.Lock()
	delete(s.running, chk.ID)
	s.pending = append(s.pending, res)
	if len(s.pending) > maxPending {
		s.pending = s.pending[len(s.pending)-maxPending:]
	}
	s.mu.Unlock()
	s.flush(ctx)
}

func (s *scheduler) flush(ctx context.Context) {
	s.mu.Lock()
	batch := s.pending
	s.pending = nil
	s.mu.Unlock()
	if len(batch) == 0 {
		return
	}
	if err := s.c.report(ctx, batch); err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("report %d result(s), will retry: %v", len(batch), err)
		}
		s.mu.Lock()
		s.pending = append(batch, s.pending...)
		if len(s.pending) > maxPending {
			s.pending = s.pending[len(s.pending)-maxPending:]
		}
		s.mu.Unlock()
	}
}
