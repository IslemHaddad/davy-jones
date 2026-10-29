package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"davy-jones/monitor/internal/proto"
)

func TestRunCheckExitCodes(t *testing.T) {
	ok := RunCheck(context.Background(), proto.Check{ID: "a", Command: "echo hello", TimeoutSeconds: 5})
	if ok.ExitCode != 0 || strings.TrimSpace(ok.Output) != "hello" {
		t.Fatalf("true command: %+v", ok)
	}
	bad := RunCheck(context.Background(), proto.Check{ID: "b", Command: "echo oops >&2; exit 3", TimeoutSeconds: 5})
	if bad.ExitCode != 3 || strings.TrimSpace(bad.Output) != "oops" {
		t.Fatalf("false command: %+v", bad)
	}
}

func TestRunCheckTimeoutKillsPipeline(t *testing.T) {
	start := time.Now()
	res := RunCheck(context.Background(), proto.Check{ID: "c", Command: "sleep 30 | cat", TimeoutSeconds: 1})
	if res.ExitCode != -1 || !strings.Contains(res.Output, "timed out") {
		t.Fatalf("timeout result: %+v", res)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("timeout took %s: the pipeline wasn't killed", elapsed)
	}
}

func TestRunCheckCapsOutput(t *testing.T) {
	res := RunCheck(context.Background(), proto.Check{ID: "d", Command: "head -c 100000 /dev/zero", TimeoutSeconds: 5})
	if len(res.Output) != proto.MaxOutputBytes {
		t.Fatalf("output length %d, want %d", len(res.Output), proto.MaxOutputBytes)
	}
}
