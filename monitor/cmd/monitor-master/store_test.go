package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"davy-jones/monitor/internal/proto"
)

func TestTransition(t *testing.T) {
	cases := []struct {
		name string
		prev CheckStatus
		ok   bool
		want string
	}{
		{"first run true", CheckStatus{}, true, ""},
		{"first run false", CheckStatus{}, false, EventCheckFailed},
		{"true stays true", CheckStatus{Known: true, OK: true}, true, ""},
		{"true to false", CheckStatus{Known: true, OK: true}, false, EventCheckFailed},
		{"false stays false", CheckStatus{Known: true, OK: false}, false, ""},
		{"false to true", CheckStatus{Known: true, OK: false}, true, EventCheckRecovered},
	}
	for _, tc := range cases {
		if got := Transition(tc.prev, tc.ok); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRecordResultsNotifiesOnlyOnChange(t *testing.T) {
	s := newTestStore(t)
	w, _, err := s.CreateWorker("web-01")
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.CreateCheck(CheckDef{WorkerID: w.ID, Name: "nginx", Command: "true", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}

	run := func(code int) []RecordedResult {
		return s.RecordResults(w.ID, []proto.Result{{CheckID: c.ID, ExitCode: code, RanAt: time.Now()}})
	}
	if got := run(0); len(got) != 0 {
		t.Fatalf("first healthy run notified: %+v", got)
	}
	if got := run(1); len(got) != 1 || got[0].Event != EventCheckFailed {
		t.Fatalf("true->false: %+v", got)
	}
	if got := run(2); len(got) != 0 {
		t.Fatalf("still failing notified again: %+v", got)
	}
	if got := run(0); len(got) != 1 || got[0].Event != EventCheckRecovered {
		t.Fatalf("false->true: %+v", got)
	}
}

func TestRecordResultsRejectsOtherWorkersChecks(t *testing.T) {
	s := newTestStore(t)
	a, _, _ := s.CreateWorker("a")
	b, _, _ := s.CreateWorker("b")
	c, _ := s.CreateCheck(CheckDef{WorkerID: a.ID, Name: "x", Command: "true", Enabled: true})

	if got := s.RecordResults(b.ID, []proto.Result{{CheckID: c.ID, ExitCode: 1}}); len(got) != 0 {
		t.Fatalf("worker b reported on worker a's check: %+v", got)
	}
	for _, row := range s.StatusRows() {
		if row.Status.Known {
			t.Fatalf("status was recorded from the wrong worker: %+v", row)
		}
	}
}

func TestRecordResultsTruncatesOutput(t *testing.T) {
	s := newTestStore(t)
	w, _, _ := s.CreateWorker("a")
	c, _ := s.CreateCheck(CheckDef{WorkerID: w.ID, Name: "x", Command: "true", Enabled: true})
	s.RecordResults(w.ID, []proto.Result{{CheckID: c.ID, ExitCode: 1, Output: strings.Repeat("x", 10000)}})
	if got := len(s.StatusRows()[0].Status.Output); got != proto.MaxOutputBytes {
		t.Fatalf("output length %d, want %d", got, proto.MaxOutputBytes)
	}
}

func TestWorkerTokenAuth(t *testing.T) {
	s := newTestStore(t)
	w, token, _ := s.CreateWorker("a")
	if got, ok := s.AuthenticateWorker(token); !ok || got.ID != w.ID {
		t.Fatal("valid token rejected")
	}
	if _, ok := s.AuthenticateWorker("wrong"); ok {
		t.Fatal("wrong token accepted")
	}
	if _, ok := s.AuthenticateWorker(""); ok {
		t.Fatal("empty token accepted")
	}
	newToken, err := s.RotateWorkerToken(w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := s.AuthenticateWorker(token); ok {
		t.Fatal("old token still accepted after rotation")
	}
	if _, ok := s.AuthenticateWorker(newToken); !ok {
		t.Fatal("rotated token rejected")
	}
}

func TestSilentWorkersAlertOnceAndRecover(t *testing.T) {
	s := newTestStore(t)
	w, _, _ := s.CreateWorker("a")
	s.CreateCheck(CheckDef{WorkerID: w.ID, Name: "x", Command: "true", Enabled: true})

	start := time.Now()
	if got := s.MarkSilentWorkers(start, time.Minute); len(got) != 0 {
		t.Fatal("a worker never seen was marked silent")
	}
	s.TouchWorker(w.ID, start)
	if got := s.MarkSilentWorkers(start.Add(30*time.Second), time.Minute); len(got) != 0 {
		t.Fatal("marked silent inside the window")
	}
	if got := s.MarkSilentWorkers(start.Add(2*time.Minute), time.Minute); len(got) != 1 {
		t.Fatal("not marked silent after the window")
	}
	if got := s.MarkSilentWorkers(start.Add(3*time.Minute), time.Minute); len(got) != 0 {
		t.Fatal("silent alert repeated")
	}
	if !s.TouchWorker(w.ID, start.Add(4*time.Minute)) {
		t.Fatal("TouchWorker didn't report the worker coming back")
	}
}

func TestStatePersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, _ := OpenStore(path)
	w, token, _ := s.CreateWorker("a")
	s.CreateCheck(CheckDef{WorkerID: w.ID, Name: "x", Command: "true", Enabled: true})
	if err := s.SetWebhookURL("https://example.invalid/hook"); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.Checks()) != 1 || reopened.WebhookURL() != "https://example.invalid/hook" {
		t.Fatal("state not persisted")
	}
	if _, ok := reopened.AuthenticateWorker(token); !ok {
		t.Fatal("worker token not persisted")
	}
}

func TestValidation(t *testing.T) {
	s := newTestStore(t)
	w, _, _ := s.CreateWorker("a")
	bad := []CheckDef{
		{WorkerID: w.ID, Name: "", Command: "true"},
		{WorkerID: w.ID, Name: "x", Command: " "},
		{WorkerID: w.ID, Name: "x", Command: "true", IntervalSeconds: 5},
		{WorkerID: "nope", Name: "x", Command: "true"},
	}
	for _, c := range bad {
		if _, err := s.CreateCheck(c); err == nil {
			t.Errorf("accepted invalid check %+v", c)
		}
	}
	if err := s.SetWebhookURL("file:///etc/passwd"); err == nil {
		t.Error("accepted a non-http webhook URL")
	}
}
