package main

import (
	"regexp"
	"strings"
	"sync"
)

// shellRecorder reconstructs the command lines a user types in an
// interactive SSH shell so each one lands in the audit log individually,
// instead of the trail only showing "a shell was opened on host X".
//
// It works by replaying the client's raw keystrokes: everything the browser
// sends as terminal input is fed through Input(), accumulated into a line
// buffer, and flushed as one command when Enter is pressed. That is the same
// approach bastion hosts use, and it comes with the same known limits --
// documented here rather than hidden, because an audit trail nobody
// understands the edges of is worse than one whose edges are written down:
//
//   - Tab-completion and history recall (arrow keys, Ctrl-R) edit the line
//     on the *remote* side, where we never see the result. Lines touched by
//     either are still recorded, but flagged approximate.
//   - Text pasted into the terminal arrives as ordinary input, so it is
//     captured correctly.
//   - Output-side effects (what the command printed) are not recorded --
//     this is a command trail, not a session replay.
//
// It also watches the remote's *output* so it can recognise a password
// prompt and refuse to record whatever is typed at it. Without that, the
// first `sudo` in any session would write the user's password in plaintext
// into the audit log.
type shellRecorder struct {
	mu     sync.Mutex
	buf    []rune
	esc    escState
	approx bool // tab-completion or history editing touched this line

	// tail holds the last chunk of remote output with escape sequences
	// stripped, so a prompt split across writes is still recognisable.
	tail     string
	secret   bool // remote is currently prompting for a password/passphrase
	onCommit func(command string)
}

type escState int

const (
	escNone escState = iota
	escStart
	escCSI
)

const outputTailLimit = 256

// A prompt is only treated as a secret prompt when the cue is the last thing
// on the line -- the remote has printed it and is now waiting on input.
var secretPromptRe = regexp.MustCompile(`(?i)(password|passphrase|verification code|secret|token)[^:\r\n]*:\s*$`)

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]`)

func newShellRecorder(onCommit func(command string)) *shellRecorder {
	return &shellRecorder{onCommit: onCommit}
}

// Input consumes one chunk of client keystrokes.
func (s *shellRecorder) Input(data string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, r := range data {
		switch s.esc {
		case escStart:
			// ESC [ (CSI) and ESC O (SS3) introduce multi-byte sequences --
			// arrow keys, Home/End, function keys. Anything else is a lone
			// two-byte escape (Alt-<key>, e.g. Alt-B word-back).
			if r == '[' || r == 'O' {
				s.esc = escCSI
			} else {
				s.esc = escNone
				s.approx = true
			}
			continue
		case escCSI:
			// Parameter and intermediate bytes run up to a final byte in
			// @-~, which ends the sequence.
			if r >= '@' && r <= '~' {
				s.esc = escNone
				s.approx = true
			}
			continue
		}

		switch r {
		case '\x1b':
			s.esc = escStart
		case '\r', '\n':
			s.commit()
		case '\x7f', '\x08': // Backspace / Ctrl-H
			if n := len(s.buf); n > 0 {
				s.buf = s.buf[:n-1]
			}
		case '\x03', '\x04', '\x15': // Ctrl-C / Ctrl-D / Ctrl-U discard the line
			s.reset()
		case '\x17': // Ctrl-W deletes the previous word
			s.deleteWord()
		case '\t':
			s.approx = true
		case '\x12': // Ctrl-R reverse history search
			s.approx = true
		default:
			// Skip the remaining control characters; keep everything
			// printable (including pasted multi-byte UTF-8).
			if r >= 0x20 {
				s.buf = append(s.buf, r)
			}
		}
	}
}

// Output consumes one chunk of remote output. Its only job is deciding
// whether the shell is currently sitting at a password prompt.
func (s *shellRecorder) Output(p []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.tail += ansiRe.ReplaceAllString(string(p), "")
	if len(s.tail) > outputTailLimit {
		s.tail = s.tail[len(s.tail)-outputTailLimit:]
	}
	// Only the current (unterminated) line matters: once the remote emits a
	// newline it has moved past the prompt.
	current := s.tail
	if i := strings.LastIndexAny(current, "\r\n"); i >= 0 {
		current = current[i+1:]
	}
	s.secret = secretPromptRe.MatchString(current)
}

// commit ends the current line and hands it to onCommit. Caller holds s.mu.
func (s *shellRecorder) commit() {
	line := strings.TrimSpace(string(s.buf))
	approx := s.approx
	secret := s.secret
	s.reset()

	switch {
	case secret:
		// Recorded as an event but never as content -- see the type comment.
		s.onCommit("[secret entered at a prompt — not recorded]")
	case line == "" && approx:
		s.onCommit("[recalled from shell history — not captured]")
	case line == "":
		// A bare Enter at the prompt; nothing happened worth recording.
	case approx:
		s.onCommit(line + " [approximate: tab-completion or history editing]")
	default:
		s.onCommit(line)
	}
}

// reset clears the line buffer. Caller holds s.mu.
func (s *shellRecorder) reset() {
	s.buf = s.buf[:0]
	s.approx = false
	s.esc = escNone
}

// deleteWord removes trailing whitespace then the word before it, matching
// readline's Ctrl-W. Caller holds s.mu.
func (s *shellRecorder) deleteWord() {
	n := len(s.buf)
	for n > 0 && s.buf[n-1] == ' ' {
		n--
	}
	for n > 0 && s.buf[n-1] != ' ' {
		n--
	}
	s.buf = s.buf[:n]
}

// recorderWriter feeds the remote's output stream into a shellRecorder while
// passing it through untouched (used via io.MultiWriter alongside the
// WebSocket writer).
type recorderWriter struct{ rec *shellRecorder }

func (w recorderWriter) Write(p []byte) (int, error) {
	w.rec.Output(p)
	return len(p), nil
}
