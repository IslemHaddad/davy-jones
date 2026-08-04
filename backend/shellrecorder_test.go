package main

import (
	"reflect"
	"testing"
)

func record(t *testing.T, steps func(r *shellRecorder)) []string {
	t.Helper()
	var got []string
	r := newShellRecorder(func(cmd string) { got = append(got, cmd) })
	steps(r)
	return got
}

func TestShellRecorderBasicLines(t *testing.T) {
	got := record(t, func(r *shellRecorder) {
		r.Input("ls -la\r")
		r.Input("echo ")
		r.Input("hi\r")
	})
	want := []string{"ls -la", "echo hi"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestShellRecorderEditingKeys(t *testing.T) {
	got := record(t, func(r *shellRecorder) {
		r.Input("lz\x7fs\r")            // backspace
		r.Input("rm -rf /tmp\x17foo\r") // ctrl-w drops "/tmp"
		r.Input("secret\x03")           // ctrl-c discards the line entirely
		r.Input("whoami\r")
		r.Input("\r") // bare enter records nothing
	})
	want := []string{"ls", "rm -rf foo", "whoami"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestShellRecorderArrowKeysAreNotTypedText(t *testing.T) {
	// An arrow key must not leak "[A" into the command, and must mark the
	// line approximate since the remote may have swapped in history.
	got := record(t, func(r *shellRecorder) {
		r.Input("\x1b[A\r")
		r.Input("cat f\x1b[Doo\r")
	})
	want := []string{
		"[recalled from shell history — not captured]",
		"cat foo [approximate: tab-completion or history editing]",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestShellRecorderRedactsPasswordPrompt(t *testing.T) {
	got := record(t, func(r *shellRecorder) {
		r.Input("sudo apt update\r")
		r.Output([]byte("[sudo] password for islem: "))
		r.Input("hunter2\r")
		r.Output([]byte("\r\nReading package lists...\r\nislem@box:~$ "))
		r.Input("exit\r")
	})
	want := []string{
		"sudo apt update",
		"[secret entered at a prompt — not recorded]",
		"exit",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	for _, e := range got {
		if e == "hunter2" {
			t.Fatal("password leaked into the audit trail")
		}
	}
}

func TestShellRecorderOrdinaryPromptIsNotSecret(t *testing.T) {
	// A normal shell prompt ends in $ or #, not a password cue -- commands
	// after it must be recorded in full.
	got := record(t, func(r *shellRecorder) {
		r.Output([]byte("\x1b[32mislem@box\x1b[0m:~$ "))
		r.Input("uptime\r")
	})
	want := []string{"uptime"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}
