package main

import (
	"strings"
)

// ServiceStatus is what a host reports about one service it was asked about.
//
// OnThisHost is the interesting one for the graph. A Swarm service is
// declared on a manager but its tasks actually run on whichever node the
// scheduler picked, so "this host knows about the service" and "this host is
// running the service" are different claims. Only the second one justifies
// drawing an edge from host to service, and that's what this reports.
type ServiceStatus struct {
	Name    string `json:"name"`
	Running bool   `json:"running"`
	// State is the raw string the host reported ("Running 4 hours ago",
	// "exited", "Failed ...") -- shown on hover so an unhealthy service
	// explains itself without needing a shell.
	State string `json:"state"`
	// Nodes are the swarm nodes the tasks were scheduled onto. Empty for a
	// plain (non-Swarm) container, which by definition runs where it lives.
	Nodes      []string `json:"nodes,omitempty"`
	OnThisHost bool     `json:"onThisHost"`
	Found      bool     `json:"found"`
}

// serviceStatusScript asks about every requested name in one SSH round-trip.
// For each name it tries Swarm first and falls back to a plain container, so
// the same call works on a Swarm manager and on a stand-alone Docker host.
//
// Output is one labelled line per name, plus the host's own hostname, which
// is what the Swarm node names get compared against.
func serviceStatusScript(names []string) string {
	var b strings.Builder
	// The Node column in `docker service ps` holds the name Swarm knows the
	// daemon by, which is what `docker info --format '{{.Name}}'` returns --
	// not necessarily the output of `hostname`. Comparing against the wrong
	// one would mark every service as running elsewhere and unlink the graph.
	b.WriteString("me=$(docker info --format '{{.Name}}' 2>/dev/null); [ -z \"$me\" ] && me=$(hostname); echo \"HOSTNAME $me\"\n")
	for _, name := range names {
		q := shellQuote(name)
		b.WriteString(`svc=$(docker service ps --no-trunc --format '{{.Node}}~{{.CurrentState}}' ` + q + ` 2>/dev/null | head -20 | tr '\n' ';')` + "\n")
		b.WriteString(`if [ -n "$svc" ]; then printf 'SVC %s|%s\n' ` + q + ` "$svc"; else ` +
			`ctr=$(docker inspect -f '{{.State.Status}}' ` + q + ` 2>/dev/null); ` +
			`printf 'CTR %s|%s\n' ` + q + ` "$ctr"; fi` + "\n")
	}
	return b.String()
}

// DockerServiceStatuses reports the state of the named Docker services as
// seen from this host.
func DockerServiceStatuses(host Host, cred Credential, names []string) []ServiceStatus {
	out := make([]ServiceStatus, 0, len(names))
	if len(names) == 0 {
		return out
	}

	result := RunSSHCommand(host, cred, serviceStatusScript(names))
	byName := parseServiceStatuses(result.Stdout)
	for _, name := range names {
		if s, ok := byName[name]; ok {
			out = append(out, s)
			continue
		}
		// Unreachable host, no docker, or a name the host didn't answer for:
		// reported as not-found rather than as "stopped", so the UI can tell
		// "definitely down" apart from "couldn't tell".
		out = append(out, ServiceStatus{Name: name})
	}
	return out
}

func parseServiceStatuses(stdout string) map[string]ServiceStatus {
	statuses := map[string]ServiceStatus{}
	hostname := ""

	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "HOSTNAME "):
			hostname = strings.TrimSpace(strings.TrimPrefix(line, "HOSTNAME "))

		case strings.HasPrefix(line, "SVC "):
			name, payload, ok := splitLabelled(line, "SVC ")
			if !ok {
				continue
			}
			s := ServiceStatus{Name: name, Found: true}
			for _, task := range strings.Split(payload, ";") {
				task = strings.TrimSpace(task)
				if task == "" {
					continue
				}
				node, state, found := strings.Cut(task, "~")
				if !found {
					continue
				}
				node = strings.TrimSpace(node)
				state = strings.TrimSpace(state)
				if s.State == "" {
					s.State = state
				}
				if node != "" && !containsString(s.Nodes, node) {
					s.Nodes = append(s.Nodes, node)
				}
				// Swarm keeps historical tasks around ("Shutdown", "Failed"),
				// so a service counts as running if any *current* task is,
				// and it's on this host only for a task that is running here.
				if strings.HasPrefix(state, "Running") {
					s.Running = true
					s.State = state
					if node == hostname {
						s.OnThisHost = true
					}
				}
			}
			statuses[name] = s

		case strings.HasPrefix(line, "CTR "):
			name, state, ok := splitLabelled(line, "CTR ")
			if !ok {
				continue
			}
			state = strings.TrimSpace(state)
			if state == "" {
				// docker inspect found nothing -- the name isn't a container
				// on this host at all.
				statuses[name] = ServiceStatus{Name: name}
				continue
			}
			statuses[name] = ServiceStatus{
				Name:    name,
				Found:   true,
				State:   state,
				Running: state == "running",
				// A plain container only exists on the host running it.
				OnThisHost: true,
			}
		}
	}
	return statuses
}

// splitLabelled parses `PREFIX<name>|<payload>`.
func splitLabelled(line, prefix string) (name, payload string, ok bool) {
	rest := strings.TrimPrefix(line, prefix)
	name, payload, ok = strings.Cut(rest, "|")
	return strings.TrimSpace(name), payload, ok
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
