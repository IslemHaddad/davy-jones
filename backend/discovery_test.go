package main

import (
	"reflect"
	"testing"
)

func TestParseDiscoveryNames(t *testing.T) {
	out := "web\napi\n\nworker\napi\n"
	got := parseDiscoveryNames(out)
	want := []string{"api", "web", "worker"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParseDiscoveryNamesDropsNonNameLines(t *testing.T) {
	// Header rows and leaked error text both contain spaces; real container
	// and service names never do.
	out := "NAME STATUS\nweb\nbash: lxc: command not found\napi\n"
	got := parseDiscoveryNames(out)
	want := []string{"api", "web"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParseDiscoveryNamesEmptyIsNotNil(t *testing.T) {
	// The API returns this straight to JSON; nil would serialize as null and
	// break the client's array handling.
	if got := parseDiscoveryNames("\n  \n"); len(got) != 0 || got == nil {
		t.Fatalf("got %#v, want empty non-nil slice", got)
	}
}

func TestDiscoverServicesRejectsUnknownType(t *testing.T) {
	res := DiscoverServices(Host{}, Credential{}, "Kubernetes")
	if res.Error == "" {
		t.Fatal("expected an error for an unknown service type")
	}
	if res.Command != "" {
		t.Fatal("an unknown type must not resolve to a command")
	}
}

func TestDiscoverServicesNodeHasNoCommand(t *testing.T) {
	// Must not attempt an SSH connection -- it returns before running.
	res := DiscoverServices(Host{IP: "203.0.113.1"}, Credential{}, "Node")
	if res.Error == "" {
		t.Fatal("expected an explanatory error for Node")
	}
	if len(res.Names) != 0 {
		t.Fatalf("expected no names, got %q", res.Names)
	}
}

func TestDockerDiscoveryFiltersToThisNode(t *testing.T) {
	// Regression: `docker service ls` alone lists the whole swarm, so
	// scanning a manager claimed other nodes' services as its own. The
	// command must cross-check each service against this node.
	cmd := discoveryCommands["Docker"]
	for _, want := range []string{
		"docker service ps",
		"--filter desired-state=running",
		"{{.Node}}",
		`grep -Fxq "$me"`,
	} {
		if !containsSubstring(cmd, want) {
			t.Errorf("Docker discovery command is missing %q:\n%s", want, cmd)
		}
	}
	// And it must not simply print the cluster-wide service list.
	if containsSubstring(cmd, `out=$(docker service ls`) {
		t.Error("Docker discovery still emits the raw cluster-wide service list")
	}
}

func TestDockerDiscoveryUsesDockerNodeName(t *testing.T) {
	// `hostname` and the name Swarm uses in the Node column can differ.
	cmd := discoveryCommands["Docker"]
	if !containsSubstring(cmd, "docker info --format '{{.Name}}'") {
		t.Errorf("expected the node name to come from docker info:\n%s", cmd)
	}
	if !containsSubstring(cmd, `[ -z "$me" ] && me=$(hostname)`) {
		t.Errorf("expected a hostname fallback:\n%s", cmd)
	}
}

func TestDiscoverableTypes(t *testing.T) {
	got := DiscoverableTypes()
	want := []string{"Docker", "LXC"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}
