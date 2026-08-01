package main

import (
	"bytes"
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type CommandResult struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
	Error    string `json:"error,omitempty"`
}

// runLocal executes a local command as an argv array (never through a shell,
// so container names / target IPs can't be used for shell injection).
func runLocal(timeout time.Duration, name string, args ...string) CommandResult {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	result := CommandResult{}
	err := cmd.Run()
	result.Stdout = strings.TrimSpace(stdout.String())
	result.Stderr = strings.TrimSpace(stderr.String())

	if err == nil {
		result.ExitCode = 0
		return result
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ExitCode = exitErr.ExitCode()
		return result
	}
	result.ExitCode = -1
	result.Error = err.Error()
	return result
}

func DockerStart(container string) CommandResult {
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "start", container)
}

func DockerStop(container string) CommandResult {
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "stop", container)
}

func DockerStatus(container string) CommandResult {
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "inspect", "-f", "{{.State.Status}}", container)
}

func DockerExecPing(container, targetIP string) CommandResult {
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "exec", container, "ping", "-c", "3", targetIP)
}

func DockerExecNc(container, targetIP string, port int) CommandResult {
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "exec", container, "nc", "-vz", "-w", "3", targetIP, strconv.Itoa(port))
}
