package main

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"davy-jones/monitor/internal/proto"
)

// cappedBuffer keeps the first MaxOutputBytes written to it and discards the
// rest, so a chatty command can't grow the worker's memory without bound.
type cappedBuffer struct {
	mu  sync.Mutex
	buf []byte
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if room := proto.MaxOutputBytes - len(b.buf); room > 0 {
		if len(p) > room {
			b.buf = append(b.buf, p[:room]...)
		} else {
			b.buf = append(b.buf, p...)
		}
	}
	return len(p), nil
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.buf)
}

// RunCheck runs the check's command through /bin/sh and turns its exit code
// into a result: 0 is true, anything else -- including a timeout or a
// command that can't start -- is false.
func RunCheck(parent context.Context, chk proto.Check) proto.Result {
	timeout := time.Duration(chk.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", chk.Command)
	// Own process group, so a timeout kills the whole pipeline the shell
	// started, not just the shell -- otherwise `sleep 999 | cat` leaves the
	// sleep running after the check has "finished".
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	var out cappedBuffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	start := time.Now()
	err := cmd.Run()
	res := proto.Result{
		CheckID:    chk.ID,
		DurationMs: time.Since(start).Milliseconds(),
		RanAt:      start.UTC(),
		Output:     out.String(),
	}

	var exitErr *exec.ExitError
	switch {
	case err == nil:
		res.ExitCode = 0
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		res.ExitCode = -1
		res.Output = fmt.Sprintf("timed out after %s\n%s", timeout, res.Output)
	case errors.As(err, &exitErr):
		res.ExitCode = exitErr.ExitCode()
	default:
		res.ExitCode = -1
		res.Output = fmt.Sprintf("could not run command: %v\n%s", err, res.Output)
	}
	return res
}
