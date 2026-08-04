package main

import (
	"sort"
	"strings"
)

// Service discovery asks a host what it is already running, so services
// don't have to be typed in by hand. Each service type knows the one command
// that enumerates it; the command prints one name per line and nothing else,
// which is the whole parsing contract.
//
// Commands are fixed strings chosen here, never assembled from user input --
// the only thing the caller picks is which of these to run.
var discoveryCommands = map[string]string{
	// Docker discovery must answer "what runs HERE", not "what exists in the
	// cluster". `docker service ls` on a Swarm manager lists every service in
	// the whole swarm regardless of which node its tasks landed on, so using
	// it directly attributes other nodes' services to this host. Instead each
	// service is checked against this node's name, and only those with a task
	// actually running here are reported.
	//
	// Node name comes from `docker info` rather than `hostname`: that's the
	// name Swarm itself uses in the Node column, and the two can differ.
	"Docker": `me=$(docker info --format '{{.Name}}' 2>/dev/null); ` +
		`[ -z "$me" ] && me=$(hostname); ` +
		`svcs=$(docker service ls --format '{{.Name}}' 2>/dev/null); ` +
		`if [ -n "$svcs" ]; then ` +
		// An `if` rather than `cmd && printf`: with && the loop's exit status
		// is the last grep's, so a final service that isn't on this node
		// would make the whole script exit non-zero and look like a failure.
		`for s in $svcs; do ` +
		`if docker service ps "$s" --filter desired-state=running --format '{{.Node}}' 2>/dev/null | grep -Fxq "$me"; ` +
		`then printf '%s\n' "$s"; fi; ` +
		`done; ` +
		`else docker ps --format '{{.Names}}' 2>/dev/null; fi`,
	// `lxc list` is LXD; lxc-ls covers a classic LXC host.
	"LXC": `out=$(lxc list -c n --format csv 2>/dev/null); ` +
		`if [ -z "$out" ]; then out=$(lxc-ls -1 2>/dev/null); fi; ` +
		`printf '%s\n' "$out"`,
	// "Node" has no registry to enumerate -- a Node app is just a process.
	// Present as a known type with no command so the UI can say so plainly
	// instead of offering a button that does nothing.
	"Node": "",
}

// DiscoveryResult is one discovery run: the names found, plus the command and
// raw output so a host that answered unexpectedly can be diagnosed from the
// UI instead of needing a shell.
type DiscoveryResult struct {
	Type    string   `json:"type"`
	Command string   `json:"command"`
	Names   []string `json:"names"`
	Raw     string   `json:"raw,omitempty"`
	Error   string   `json:"error,omitempty"`
}

// DiscoverServices runs the type's discovery command on the host and returns
// the service names it reported.
func DiscoverServices(host Host, cred Credential, serviceType string) DiscoveryResult {
	command, known := discoveryCommands[serviceType]
	if !known {
		return DiscoveryResult{Type: serviceType, Error: "no discovery command for service type " + serviceType}
	}
	result := DiscoveryResult{Type: serviceType, Command: command, Names: []string{}}
	if command == "" {
		result.Error = serviceType + " services can't be enumerated automatically -- add them by hand"
		return result
	}

	ssh := RunSSHCommand(host, cred, command)
	result.Raw = strings.TrimSpace(ssh.Stdout)
	if ssh.Error != "" {
		result.Error = ssh.Error
		return result
	}
	if ssh.ExitCode != 0 {
		result.Error = strings.TrimSpace(ssh.Stderr)
		if result.Error == "" {
			result.Error = "discovery command failed"
		}
		return result
	}

	result.Names = parseDiscoveryNames(ssh.Stdout)
	if len(result.Names) == 0 && strings.TrimSpace(ssh.Stderr) != "" {
		// Exit 0 with nothing on stdout and a complaint on stderr usually
		// means the tool isn't installed; surface that rather than an
		// unexplained empty list.
		result.Error = strings.TrimSpace(ssh.Stderr)
	}
	return result
}

// parseDiscoveryNames turns one-name-per-line output into a sorted, unique
// list, dropping blanks and anything that looks like a header or a shell
// complaint rather than a name.
func parseDiscoveryNames(stdout string) []string {
	seen := map[string]bool{}
	var names []string
	for _, line := range strings.Split(stdout, "\n") {
		name := strings.TrimSpace(line)
		if name == "" || seen[name] {
			continue
		}
		// Names don't contain spaces in any of the formats above, so a line
		// with one is a header row or an error message that leaked through.
		if strings.ContainsAny(name, " \t") {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	sort.Strings(names)
	if names == nil {
		names = []string{}
	}
	return names
}

// DiscoverableTypes lists the service types that support discovery, for the
// UI to offer.
func DiscoverableTypes() []string {
	var out []string
	for t, cmd := range discoveryCommands {
		if cmd != "" {
			out = append(out, t)
		}
	}
	sort.Strings(out)
	return out
}
