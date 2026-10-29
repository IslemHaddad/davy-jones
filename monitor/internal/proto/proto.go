// Package proto is the wire contract between monitor-master and
// monitor-worker. Both binaries import it, so the two sides can't drift.
package proto

import "time"

// MaxOutputBytes caps the command output a worker reports per run. A check
// answers true/false; the output is only there to explain a failure, so the
// first few kilobytes are all anyone reads.
const MaxOutputBytes = 4096

// Check is one command a worker must run on its own VM. The command's exit
// code is the answer: 0 is true (healthy), anything else is false.
type Check struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Command         string `json:"command"`
	IntervalSeconds int    `json:"intervalSeconds"`
	TimeoutSeconds  int    `json:"timeoutSeconds"`
}

// ChecksResponse is what GET /api/worker/checks returns.
type ChecksResponse struct {
	Checks []Check `json:"checks"`
}

// Result is the outcome of one run of one check.
type Result struct {
	CheckID    string    `json:"checkId"`
	ExitCode   int       `json:"exitCode"`
	Output     string    `json:"output"`
	DurationMs int64     `json:"durationMs"`
	RanAt      time.Time `json:"ranAt"`
}

// ResultsRequest is the body of POST /api/worker/results.
type ResultsRequest struct {
	Results []Result `json:"results"`
}
