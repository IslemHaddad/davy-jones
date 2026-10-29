package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

const (
	EventCheckFailed    = "check_failed"
	EventCheckRecovered = "check_recovered"
	EventWorkerSilent   = "worker_silent"
	EventWorkerBack     = "worker_back"
	EventTest           = "test"
)

// Event is the JSON body POSTed to the webhook. `text` is a ready-made
// one-line summary: Slack and Mattermost incoming webhooks display it as-is,
// and anything else can use the structured fields instead.
type Event struct {
	Event    string    `json:"event"`
	OK       bool      `json:"ok"`
	Worker   string    `json:"worker"`
	Check    string    `json:"check,omitempty"`
	Command  string    `json:"command,omitempty"`
	ExitCode *int      `json:"exitCode,omitempty"`
	Output   string    `json:"output,omitempty"`
	At       time.Time `json:"at"`
	Text     string    `json:"text"`
}

func checkEvent(r RecordedResult, worker string) Event {
	code := r.Result.ExitCode
	ev := Event{
		Event:    r.Event,
		OK:       r.Event == EventCheckRecovered,
		Worker:   worker,
		Check:    r.Check.Name,
		Command:  r.Check.Command,
		ExitCode: &code,
		Output:   r.Result.Output,
		At:       r.Result.RanAt,
	}
	if ev.OK {
		ev.Text = fmt.Sprintf("✅ OK: %q on %s is true again", r.Check.Name, worker)
	} else {
		ev.Text = fmt.Sprintf("🚨 ALERT: %q on %s returned false (exit %d)", r.Check.Name, worker, code)
	}
	return ev
}

func workerEvent(kind, worker string, lastSeen time.Time) Event {
	ev := Event{Event: kind, OK: kind == EventWorkerBack, Worker: worker, At: time.Now()}
	if ev.OK {
		ev.Text = fmt.Sprintf("✅ OK: worker %s is reporting again", worker)
	} else {
		ev.Text = fmt.Sprintf("🚨 ALERT: worker %s has not reported since %s", worker, lastSeen.Format(time.RFC3339))
	}
	return ev
}

type Notifier struct {
	client *http.Client
}

func NewNotifier() *Notifier {
	return &Notifier{client: &http.Client{Timeout: 10 * time.Second}}
}

// Post delivers one event synchronously, for the "send test" button.
func (n *Notifier) Post(url string, ev Event) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	resp, err := n.client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("webhook answered %s", resp.Status)
	}
	return nil
}

// Send delivers in the background with a few retries, so a slow or failing
// webhook never holds up a worker's request.
func (n *Notifier) Send(url string, ev Event) {
	if url == "" {
		log.Printf("notify (no webhook configured): %s", ev.Text)
		return
	}
	go func() {
		delay := 2 * time.Second
		for attempt := 1; attempt <= 3; attempt++ {
			err := n.Post(url, ev)
			if err == nil {
				return
			}
			log.Printf("notify attempt %d/3 failed: %v", attempt, err)
			time.Sleep(delay)
			delay *= 2
		}
		log.Printf("notify gave up: %s", ev.Text)
	}()
}
