import { useEffect, useState } from "react";
import { Play, Square, RefreshCw, Wifi, Key } from "lucide-react";
import { api } from "../../lib/api";
import type { CommandResult, Vpn } from "../../types";

function OutputPane({ result }: { result: CommandResult | null }) {
  if (!result) return null;
  return (
    <div className="mt-2 max-h-48 overflow-auto rounded border border-border bg-canvas p-2.5 font-mono text-[11px] leading-relaxed">
      {result.stdout && (
        <pre className="whitespace-pre-wrap text-ink">{result.stdout}</pre>
      )}
      {result.stderr && (
        <pre className="whitespace-pre-wrap text-red-400">{result.stderr}</pre>
      )}
      {result.error && (
        <pre className="whitespace-pre-wrap text-red-400">{result.error}</pre>
      )}
      <div className="mt-1.5 border-t border-border pt-1.5 text-ink-faint">
        exit code: {result.exitCode}
      </div>
    </div>
  );
}

export function VpnDiagnostics({ vpn }: { vpn: Vpn }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pingTarget, setPingTarget] = useState("");
  const [pingResult, setPingResult] = useState<CommandResult | null>(null);
  const [ncResult, setNcResult] = useState<CommandResult | null>(null);

  async function refreshStatus() {
    try {
      const res = await api.vpnDiagnostics.dockerStatus(vpn.id);
      setStatus(res.stdout || res.error || "unknown");
    } catch (e) {
      setStatus(String(e));
    }
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vpn.id]);

  async function handleStart() {
    setBusy("start");
    try {
      await api.vpnDiagnostics.dockerStart(vpn.id);
      await refreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function handleStop() {
    setBusy("stop");
    try {
      await api.vpnDiagnostics.dockerStop(vpn.id);
      await refreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function handlePing() {
    if (!pingTarget.trim()) return;
    setBusy("ping");
    try {
      setPingResult(await api.vpnDiagnostics.dockerPing(vpn.id, pingTarget));
    } finally {
      setBusy(null);
    }
  }

  async function handleNc() {
    if (!pingTarget.trim()) return;
    setBusy("nc");
    try {
      setNcResult(await api.vpnDiagnostics.dockerNc(vpn.id, pingTarget, 22));
    } finally {
      setBusy(null);
    }
  }

  const isRunning = status?.trim() === "running";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="section-header mb-2 flex items-center gap-1.5">
          <Key size={11} />
          Gateway Config
        </div>
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <dt className="text-ink-faint">Remote Gateway</dt>
          <dd className="text-right font-mono text-ink">{vpn.remoteGateway}</dd>
          <dt className="text-ink-faint">Port</dt>
          <dd className="text-right font-mono text-ink">{vpn.port}</dd>
          <dt className="text-ink-faint">Certificate</dt>
          <dd className="text-right text-ink">{vpn.clientCertificate}</dd>
          <dt className="text-ink-faint">Username</dt>
          <dd className="text-right font-mono text-ink">{vpn.username}</dd>
          <dt className="text-ink-faint">Container</dt>
          <dd className="text-right font-mono text-ink">
            {vpn.clientContainer}
          </dd>
        </dl>
      </div>

      <div>
        <div className="section-header mb-2 flex items-center justify-between">
          <span>Docker Client</span>
          <button
            onClick={refreshStatus}
            className="text-ink-faint hover:text-ink"
          >
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isRunning ? "bg-emerald-400" : "bg-red-500"
            }`}
          />
          <span className="font-mono text-ink-muted">
            {status ?? "checking..."}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-card disabled:opacity-40"
          >
            <Play size={12} />
            Start
          </button>
          <button
            onClick={handleStop}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-card disabled:opacity-40"
          >
            <Square size={12} />
            Stop
          </button>
        </div>
      </div>

      <div>
        <div className="section-header mb-2 flex items-center gap-1.5">
          <Wifi size={11} />
          Ping Through Container
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={pingTarget}
            onChange={(e) => setPingTarget(e.target.value)}
            placeholder="10.0.0.5"
            className="flex-1 rounded border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-border-strong"
          />
          <button
            onClick={handlePing}
            disabled={busy !== null || !pingTarget.trim()}
            className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-card disabled:opacity-40"
          >
            Ping
          </button>
          <button
            onClick={handleNc}
            disabled={busy !== null || !pingTarget.trim()}
            className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-card disabled:opacity-40"
          >
            Check :22
          </button>
        </div>
        <OutputPane result={pingResult ?? ncResult} />
      </div>
    </div>
  );
}
