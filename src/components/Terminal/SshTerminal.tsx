import { useState, type KeyboardEvent } from "react";
import { Terminal as TerminalIcon, Play } from "lucide-react";
import { api } from "../../lib/api";
import type { SSHResult } from "../../types";

export function SshTerminal({ hostId }: { hostId: string }) {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SSHResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function run() {
    if (!command.trim() || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.ssh.exec(hostId, command);
      setResult(res);
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") run();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="section-header flex items-center gap-1.5">
        <TerminalIcon size={11} />
        SSH Command
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. systemctl status nginx"
          className="flex-1 rounded border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-border-strong"
        />
        <button
          onClick={run}
          disabled={running || !command.trim()}
          className="flex items-center gap-1 rounded border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-card disabled:opacity-40"
        >
          <Play size={12} />
          {running ? "..." : "Run"}
        </button>
      </div>

      {runError && <p className="text-xs text-red-400">{runError}</p>}

      <div className="max-h-64 overflow-auto rounded border border-border bg-canvas p-2.5 font-mono text-[11px] leading-relaxed">
        {!result && !runError && (
          <span className="text-ink-faint">Output will appear here.</span>
        )}
        {result && (
          <>
            {result.stdout && (
              <pre className="whitespace-pre-wrap text-ink">{result.stdout}</pre>
            )}
            {result.stderr && (
              <pre className="whitespace-pre-wrap text-red-400">
                {result.stderr}
              </pre>
            )}
            {result.error && (
              <pre className="whitespace-pre-wrap text-red-400">
                {result.error}
              </pre>
            )}
            <div className="mt-1.5 border-t border-border pt-1.5 text-ink-faint">
              exit code: {result.exitCode}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
