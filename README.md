# Davy Jones

A local-first admin dashboard that visualizes VPNs, hosts, and services as
an interactive node graph, and lets you run SSH commands and manage
Docker-based VPN clients from the UI — reaching out to every host and
container under its control like tentacles from one center.

## Architecture

A single Go binary serves both the JSON API and the built React frontend
(embedded via `go:embed` — no separate static file directory in production):

```
Browser (fetch) --same origin--> Go server --> SSH / Docker / local JSON files
```

- `backend/` — Go server. Owns everything: JSON file storage, admin
  auth/sessions, SSH exec (`golang.org/x/crypto/ssh`), TCP ping, Docker VPN
  container management (`os/exec`), interactive SSH shells over WebSocket,
  and serving the embedded frontend build.
- `src/` — React + TypeScript + Vite + Tailwind + `@xyflow/react` frontend.
  Talks to the backend via plain `fetch()` against relative `/api/*` paths,
  plus a WebSocket for terminal sessions.

### Interactive shells & saved commands

Each host has an "Open Interactive Shell" button (a real PTY over
`golang.org/x/crypto/ssh`, rendered with `xterm.js`) and a "Saved Commands"
list where you name and store commands against that host -- e.g. "Tail
nginx" → `docker logs -f nginx`, or "Pod logs" → `kubectl logs -n prod
api-0`. Running one streams live output the same way the interactive shell
does, so `-f`/follow-mode commands work correctly.

Opening a shell or running a saved command adds a tab to a terminal tray at
the bottom of the window (like an editor's integrated terminal) — every tab
stays connected in the background while you switch between them, and closes
its SSH session when you close the tab.

The WebSocket (`/api/ws/ssh/session`) authenticates on its first message
rather than an HTTP header, since browsers can't attach custom headers to a
WebSocket handshake: it must be `{"type":"auth","token":...}` within 5
seconds or the connection is dropped.

This runs as a normal process on a Linux host that already has Docker and
SSH access to your infrastructure — deliberately **not** containerized.
The app's whole job is to reach out and control the *host's* Docker daemon
and SSH to other machines; running it inside a container would mean mounting
`/var/run/docker.sock` into it, which is effectively full root on the host
anyway, for no real benefit.

Every runtime behavior (bind host/port, data directory, timeouts, session
length, docker binary) is environment-configurable — see
`backend/.env.example`. Nothing is hardcoded to a dev-machine path.

### Encryption at rest (seal / unseal)

All infrastructure data — VPNs, hosts, services, and SSH credentials
(passwords/private keys) — is encrypted at rest with AES-256-GCM. The master
key is never written to disk in any form. Instead, on first run you
generate it and immediately split it into 5 shares via Shamir's Secret
Sharing (any 3 reconstruct it, no single share leaks anything) using
`hashicorp/vault/shamir`. This is the same seal/unseal model Vault uses:

- The server always boots **sealed**. Unsealing requires no login of its
  own — possession of a threshold of key shares *is* the authorization,
  exactly like Vault. Everything else, including the admin password itself,
  sits behind the seal and can't be read until it's open.
- First run: `POST /api/seal/initialize` generates the key and shows you
  all 5 shares **exactly once** (the UI walks you through this). You then
  submit 3 of them back immediately to confirm and unseal, only after which
  you can create the admin password.
- Every later restart re-seals the process (the key only ever lives in
  memory) — you'll need to submit 3 shares again before the dashboard
  works, even after a successful login.
- Losing more than 2 of the 5 shares makes the data permanently
  unrecoverable by design. Store them somewhere durable (password manager,
  printed and locked away, split across people) — not a screenshot on the
  same machine.

## Prerequisites

- Go 1.22+ (auto-upgrades its toolchain to 1.25 for `x/crypto`)
- Node 18+
- `docker` on PATH if you want VPN container diagnostics to work
- Nothing else — no Rust, no system GUI libraries, no container runtime.

## Running in development

Two processes, both with hot reload:

```bash
# Terminal 1 -- Go API server
cd backend
go run .                      # listens on :8080 by default

# Terminal 2 -- Vite dev server (proxies /api/* to the Go server above)
npm install
npm run dev                   # opens on :5173
```

Open the Vite URL (http://localhost:5173) in your browser. Frontend changes
hot-reload instantly; backend changes require re-running `go run .`.

## Building for production

```bash
./scripts/build.sh
```

This runs `npm run build` (output goes straight into `backend/web/dist`,
which the Go binary embeds) and then `go build`, producing a single
self-contained binary at `bin/davy-jones`. Copy that one file
wherever you want to run it — no other assets needed.

Run it directly to try it out:

```bash
DJ_DATA_DIR=./data ./bin/davy-jones
# -> listening on http://0.0.0.0:8080
```

### Deploying as a systemd service

1. Build (`./scripts/build.sh`) and copy the binary to the target host:
   ```bash
   ssh youruser@yourserver 'sudo mkdir -p /opt/davy-jones/bin /var/lib/davy-jones /etc/davy-jones'
   scp bin/davy-jones youruser@yourserver:/tmp/
   ssh youruser@yourserver 'sudo mv /tmp/davy-jones /opt/davy-jones/bin/'
   ```
2. Create a dedicated system user and add it to the `docker` group (needed
   for the VPN container start/stop/exec diagnostics):
   ```bash
   sudo useradd --system --home /var/lib/davy-jones --shell /usr/sbin/nologin davy-jones
   sudo usermod -aG docker davy-jones
   sudo chown -R davy-jones:davy-jones /var/lib/davy-jones
   ```
3. Copy the env file and unit, then edit the env file for your setup:
   ```bash
   sudo cp deploy/env.example /etc/davy-jones/env
   sudo cp deploy/davy-jones.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now davy-jones
   ```
4. It's bound to `127.0.0.1:8080` by default in `deploy/env.example` — put a
   reverse proxy (Caddy, nginx) in front for TLS and a real hostname rather
   than exposing raw HTTP directly. This app executes SSH commands and holds
   VPN/host credentials; don't put it on the open internet without TLS.

Example Caddy config:
```
davy-jones.your-domain.internal {
    reverse_proxy 127.0.0.1:8080
}
```

## Configuration

See `backend/.env.example` for every backend setting (bind address/port,
data dir, session TTL, SSH/TCP timeouts, docker binary path) and
`.env.example` for frontend dev-only settings (Vite proxy target, ping poll
interval). Everything has a sane default; none are required for a quick
local run.

## Security notes

- This app stores and uses SSH passwords/private keys and controls Docker
  containers. Treat its data directory and any host it runs on accordingly.
- Default bind is `0.0.0.0:8080` for zero-config local use; the systemd
  deploy example above deliberately narrows that to `127.0.0.1` behind a
  reverse proxy — do the same for any real deployment.
- The service account needs `docker` group membership to run VPN container
  diagnostics, which is equivalent to root on the host. Only grant it to a
  host you already trust this tool to fully administer.
