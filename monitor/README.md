# monitor

True/false checks on your VMs, with a webhook when one changes.

- **monitor-master** — one instance. Holds the checks (defined from its web
  UI), receives results, and POSTs to a webhook when a check flips or a
  worker goes quiet.
- **monitor-worker** — one per VM. Fetches its checks from the master, runs
  each on its interval, reports the exit codes. Outbound HTTPS only; it
  never listens on a port.

A check is a shell command. **Exit code 0 = true, anything else = false.**

## Notifications

Sent only on a change, never repeated while the state holds:

| Event             | When                                                      |
|-------------------|-----------------------------------------------------------|
| `check_failed`    | A check goes true → false (or its very first run is false) |
| `check_recovered` | A check goes false → true                                 |
| `worker_silent`   | A worker hasn't reported for `MON_STALE_AFTER` (VM down, network, worker dead) |
| `worker_back`     | A silent worker reports again                             |

Webhook body (JSON POST). `text` is a ready-made summary that Slack and
Mattermost incoming webhooks display as-is:

```json
{
  "event": "check_failed",
  "ok": false,
  "worker": "web-01",
  "check": "nginx is running",
  "command": "systemctl is-active --quiet nginx",
  "exitCode": 3,
  "output": "",
  "at": "2026-10-15T13:44:07Z",
  "text": "🚨 ALERT: \"nginx is running\" on web-01 returned false (exit 3)"
}
```

## Build

```sh
cd monitor
go build -o bin/monitor-master ./cmd/monitor-master
go build -o bin/monitor-worker ./cmd/monitor-worker
```

No dependencies outside the Go standard library. The UI is embedded in the
master binary.

## Run the master

Put it on a host that is **not** one of the monitored VMs, otherwise it
can't tell you when that VM dies.

`/etc/monitor-master/env`:

```sh
MON_ADMIN_TOKEN=<long random string>   # required, ≥16 chars; signs you in to the UI
MON_ADDR=0.0.0.0:9090                  # default
MON_STALE_AFTER=3m                     # default; silent-worker threshold
MON_TLS_CERT=/etc/monitor-master/tls.crt   # optional; serve HTTPS directly
MON_TLS_KEY=/etc/monitor-master/tls.key
```

```sh
install -m 755 bin/monitor-master /usr/local/bin/
install -m 644 deploy/monitor-master.service /etc/systemd/system/
systemctl enable --now monitor-master
```

State (webhook, workers, checks, last results) is one JSON file,
`/var/lib/monitor-master/state.json`. Worker tokens are stored only as
SHA-256 hashes.

## Add a VM

1. In the UI, **Workers → Add worker**. Copy the token (it's shown once).
2. On the VM:

```sh
useradd --system --no-create-home monitor-worker
install -m 755 monitor-worker /usr/local/bin/
install -d -m 750 -o root -g monitor-worker /etc/monitor-worker
printf '%s\n' '<token>' > /etc/monitor-worker/token
chown root:monitor-worker /etc/monitor-worker/token && chmod 640 /etc/monitor-worker/token
echo 'MON_MASTER_URL=https://monitor.internal:9090' > /etc/monitor-worker/env
install -m 644 deploy/monitor-worker.service /etc/systemd/system/
systemctl enable --now monitor-worker
```

3. In the UI, **Checks → New check**: pick the worker, name it, type the
   command, set the interval. The worker picks it up within one poll (30 s).

### Cron instead of a service

`monitor-worker -once` runs every enabled check once, reports, and exits.
In `/etc/cron.d/monitor-worker`:

```cron
* * * * * monitor-worker MON_MASTER_URL=https://monitor.internal:9090 /usr/local/bin/monitor-worker -once
```

In this mode the cron schedule decides how often checks run (the per-check
interval is ignored), and `MON_STALE_AFTER` must be longer than the cron
period.

## Trust model

Commands are defined on the master and run on the VMs by `/bin/sh` as the
`monitor-worker` user. **Anyone with the admin token can run any command
on every VM, as that user.** So:

- Keep the admin token secret and the master off the public internet.
- Use TLS between workers and master (`MON_TLS_CERT`/`MON_TLS_KEY`, or a
  reverse proxy), since tokens and commands travel over that link.
- Give `monitor-worker` only the access its checks need; don't run it as root.

## Example checks

| Name                 | Command |
|----------------------|---------|
| nginx is running     | `systemctl is-active --quiet nginx` |
| Disk / under 90%     | `[ "$(df --output=pcent / \| tail -1 \| tr -dc 0-9)" -lt 90 ]` |
| Container api is up  | `[ "$(docker inspect -f '{{.State.Running}}' api)" = true ]` |
| HTTP health is 200   | `curl -fsS -o /dev/null --max-time 5 http://localhost:8080/health` |
| Port 5432 open       | `nc -z -w 3 127.0.0.1 5432` |

## API

Workers authenticate with `Authorization: Bearer <worker token>`:

- `GET /api/worker/checks` — this worker's enabled checks (also the heartbeat)
- `POST /api/worker/results` — `{"results":[{"checkId","exitCode","output","durationMs","ranAt"}]}`

The UI uses `/api/admin/*` with `Authorization: Bearer <MON_ADMIN_TOKEN>`:
`status`, `config`, `settings` (GET/PUT), `settings/test` (POST),
`workers` (GET/POST), `workers/{id}/rotate` (POST), `workers/{id}` (DELETE),
`checks` (GET/POST), `checks/{id}` (PUT/DELETE).
