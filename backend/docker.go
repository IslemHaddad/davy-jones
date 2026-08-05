package main

import (
	"bytes"
	"context"
	"os/exec"
	"regexp"
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
	return runCmd(exec.CommandContext(ctx, name, args...))
}

// runShell executes a full command line through "sh -c", for the one case
// (VPN start) where the user configures an arbitrary command line rather
// than a fixed argv -- there's no way to support user-supplied flags/quoting
// without a shell. Callers are responsible for shell-escaping any untrusted
// values substituted into the command (see shellQuote).
func runShell(timeout time.Duration, command string) CommandResult {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return runCmd(exec.CommandContext(ctx, "sh", "-c", command))
}

func runCmd(cmd *exec.Cmd) CommandResult {
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

// shellQuote wraps a value in single quotes for safe interpolation into a
// shell command line, so a crafted hostname/credential (e.g. from an
// imported project file) can't break out into arbitrary shell syntax.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// renderVpnCommand substitutes the {{host}} {{port}} {{user}} {{pass}}
// {{image}} {{container}} placeholders in vpn.Command with shell-escaped
// values. The template itself comes from a logged-in user typing into the
// VPN form, so it's trusted verbatim; only the substituted values (which
// may originate from an imported project file) need escaping.
func renderVpnCommand(vpn Vpn, cred Credential) string {
	r := strings.NewReplacer(
		"{{host}}", shellQuote(vpn.RemoteGateway),
		"{{port}}", shellQuote(strconv.Itoa(vpn.Port)),
		"{{user}}", shellQuote(cred.Username),
		"{{pass}}", shellQuote(cred.Password),
		"{{image}}", shellQuote(vpn.Image),
		"{{container}}", shellQuote(vpn.ContainerName),
	)
	return r.Replace(vpn.Command)
}

// requireContainerName guards every docker/{id} action that targets a fixed
// container name -- failing fast with a clear message instead of handing
// docker an empty positional argument.
func requireContainerName(vpn Vpn) (string, *CommandResult) {
	if strings.TrimSpace(vpn.ContainerName) == "" {
		return "", &CommandResult{ExitCode: -1, Error: "vpn has no container name configured"}
	}
	return vpn.ContainerName, nil
}

// DockerProvision (re)builds the VPN's container by removing any existing
// one with the same name and re-running the configured Command. Called when
// a VPN is created or updated, so the container reflects current config
// exactly once, up front -- Start/Stop afterward only toggle that same
// container rather than recreating it on every click.
func DockerProvision(vpn Vpn, cred Credential) CommandResult {
	if strings.TrimSpace(vpn.Command) == "" {
		return CommandResult{ExitCode: -1, Error: "vpn has no start command configured"}
	}
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	if !hasDetachFlag(vpn.Command) {
		return CommandResult{ExitCode: -1, Error: "command must run detached (-d / --detach) -- provisioning waits for it to return, so a foreground run just hangs until it times out"}
	}
	runLocal(cfg.DockerTimeout, cfg.DockerBin, "rm", "-f", name)
	return runShell(cfg.DockerTimeout, renderVpnCommand(vpn, cred))
}

// hasDetachFlag checks for a standalone -d/--detach token, so provisioning
// can fail in milliseconds with a clear message instead of blocking for the
// full docker timeout on a foreground run.
func hasDetachFlag(command string) bool {
	for _, tok := range strings.Fields(command) {
		if tok == "-d" || tok == "--detach" {
			return true
		}
	}
	return false
}

// DockerRemove deletes the VPN's container outright, for cleanup when the
// VPN itself is deleted.
func DockerRemove(vpn Vpn) CommandResult {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "rm", "-f", name)
}

// containerExists reports whether the VPN's container is present at all,
// running or stopped.
//
// `docker ps -a --filter` rather than `docker inspect` because the two
// failures have to stay distinguishable: inspect exits non-zero both when the
// container is absent and when the daemon can't be reached, and treating the
// second as "absent" would answer an unreachable Docker by trying to build a
// container. Here a clean exit with no output means definitively "not there",
// and anything else is a docker problem to report as-is.
func containerExists(name string) (bool, *CommandResult) {
	res := runLocal(cfg.DockerTimeout, cfg.DockerBin, "ps", "-a",
		"--filter", "name=^"+regexp.QuoteMeta(name)+"$", "--format", "{{.Names}}")
	if res.ExitCode != 0 || res.Error != "" {
		return false, &res
	}
	return strings.TrimSpace(res.Stdout) != "", nil
}

// DockerStart brings the VPN's container up, rebuilding it first if it is no
// longer there.
//
// Stop/start on an existing container is still the normal path -- container
// state survives it, which is why provisioning isn't done on every click.
// But "the container always exists once provisioned" is not true on every
// host: a reaper that prunes stopped containers (or an operator's `docker
// system prune`) removes it out from under us, and Start would then fail with
// "No such container" forever, with the only way out being to re-save the VPN
// to trigger a provision. Rebuilding from the same stored config is what the
// operator wanted from the button either way.
// The second return value reports whether the container had to be rebuilt,
// so the caller can say so in the audit trail rather than logging a plain
// "start" for what was really a provision.
func DockerStart(vpn Vpn, cred Credential) (CommandResult, bool) {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult, false
	}
	exists, failure := containerExists(name)
	if failure != nil {
		return *failure, false
	}
	if !exists {
		return DockerProvision(vpn, cred), true
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "start", name), false
}

func DockerStop(vpn Vpn) CommandResult {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "stop", name)
}

func DockerStatus(vpn Vpn) CommandResult {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "inspect", "-f", "{{.State.Status}}", name)
}

func DockerExecPing(vpn Vpn, targetIP string) CommandResult {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "exec", name, "ping", "-c", "3", targetIP)
}

func DockerExecNc(vpn Vpn, targetIP string, port int) CommandResult {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "exec", name, "nc", "-vz", "-w", "3", targetIP, strconv.Itoa(port))
}

// DockerLogs returns the container's recent combined stdout/stderr, so a
// container that exited right after Start (a common failure mode -- wrong
// image CMD, missing device, auth prompt with no stdin, etc.) shows *why*
// instead of just an "exited" status.
func DockerLogs(vpn Vpn, tail int) CommandResult {
	name, errResult := requireContainerName(vpn)
	if errResult != nil {
		return *errResult
	}
	if tail <= 0 {
		tail = 200
	}
	return runLocal(cfg.DockerTimeout, cfg.DockerBin, "logs", "--tail", strconv.Itoa(tail), name)
}
