package main

import "testing"

func TestParseServiceStatusesSwarmRunningHere(t *testing.T) {
	out := "HOSTNAME node-a\n" +
		"SVC web|node-a~Running 4 hours ago;node-a~Shutdown 2 days ago;\n"
	got := parseServiceStatuses(out)["web"]
	if !got.Found || !got.Running {
		t.Fatalf("expected a running service, got %+v", got)
	}
	if !got.OnThisHost {
		t.Fatal("task runs on node-a, which is this host -- should link")
	}
	if got.State != "Running 4 hours ago" {
		t.Fatalf("state: got %q", got.State)
	}
}

func TestParseServiceStatusesSwarmRunningElsewhere(t *testing.T) {
	// The manager knows about the service, but the task runs on another
	// node -- running, yet not something to link to this host.
	out := "HOSTNAME node-a\nSVC api|node-b~Running 10 minutes ago;\n"
	got := parseServiceStatuses(out)["api"]
	if !got.Running {
		t.Fatal("expected running")
	}
	if got.OnThisHost {
		t.Fatal("task runs on node-b -- must not link to node-a")
	}
	if len(got.Nodes) != 1 || got.Nodes[0] != "node-b" {
		t.Fatalf("nodes: got %q", got.Nodes)
	}
}

func TestParseServiceStatusesSwarmAllShutdown(t *testing.T) {
	out := "HOSTNAME node-a\n" +
		"SVC worker|node-a~Shutdown 3 hours ago;node-a~Failed 4 hours ago;\n"
	got := parseServiceStatuses(out)["worker"]
	if !got.Found {
		t.Fatal("service exists, should be found")
	}
	if got.Running || got.OnThisHost {
		t.Fatalf("no running task -- expected stopped and unlinked, got %+v", got)
	}
}

func TestParseServiceStatusesPlainContainer(t *testing.T) {
	out := "HOSTNAME box\nCTR redis|running\nCTR old-api|exited\n"
	statuses := parseServiceStatuses(out)

	if r := statuses["redis"]; !r.Running || !r.OnThisHost || !r.Found {
		t.Fatalf("redis: %+v", r)
	}
	// A plain container lives on the host running it, so it links either
	// way -- but it must not be reported as running.
	if o := statuses["old-api"]; o.Running || !o.OnThisHost || !o.Found {
		t.Fatalf("old-api: %+v", o)
	}
}

func TestParseServiceStatusesUnknownName(t *testing.T) {
	// Empty inspect output means no such container/service here.
	got := parseServiceStatuses("HOSTNAME box\nCTR ghost|\n")["ghost"]
	if got.Found || got.Running {
		t.Fatalf("expected not-found, got %+v", got)
	}
}

func TestDockerServiceStatusesReportsEveryRequestedName(t *testing.T) {
	// An unreachable host yields no output; every name must still come back
	// so the caller doesn't have to guess which ones went missing.
	got := DockerServiceStatuses(Host{IP: "203.0.113.1"}, Credential{}, []string{"a", "b"})
	if len(got) != 2 {
		t.Fatalf("got %d statuses, want 2", len(got))
	}
	for _, s := range got {
		if s.Found {
			t.Fatalf("%s: expected not-found from an unreachable host", s.Name)
		}
	}
}

func TestServiceStatusScriptUsesDockerNodeName(t *testing.T) {
	// Must compare against the name Swarm reports, not `hostname`, or every
	// service looks like it runs elsewhere.
	script := serviceStatusScript([]string{"web"})
	if !containsSubstring(script, "docker info --format '{{.Name}}'") {
		t.Errorf("expected docker info for the node name:\n%s", script)
	}
	if !containsSubstring(script, "HOSTNAME $me") {
		t.Errorf("expected the resolved node name to be emitted:\n%s", script)
	}
}

func TestServiceStatusScriptQuotesNames(t *testing.T) {
	// A name is user-supplied, so it must never break out of the command.
	script := serviceStatusScript([]string{"a'; rm -rf /; echo '"})
	if contains := containsSubstring(script, "; rm -rf /; echo "); !contains {
		t.Skip("name not present at all -- nothing to assert")
	}
	if containsSubstring(script, "'a'; rm -rf /") {
		t.Fatal("name was not escaped")
	}
	if !containsSubstring(script, `'\''`) {
		t.Fatal("expected shellQuote escaping of the embedded quote")
	}
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
