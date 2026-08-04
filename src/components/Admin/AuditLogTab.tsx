import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { AuditEntry } from "../../types";
import { inputClass } from "../Layout/AddResourcesPanel";

/** "shell_9f3a1c..." -> "#9f3a1c" -- enough to tell two sessions apart. */
function shortSession(id: string): string {
  return "#" + id.replace(/^shell_/, "").slice(0, 6);
}

export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [usernameFilter, setUsernameFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  // Set by clicking a session badge: narrows the list to one shell session,
  // which is the only practical way to read a long command trail.
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);

  useEffect(() => {
    api.audit.list().then((res) => {
      setEntries(res);
      setLoading(false);
    });
  }, []);

  const filtered = entries.filter((e) => {
    if (
      usernameFilter &&
      !e.username.toLowerCase().includes(usernameFilter.toLowerCase())
    )
      return false;
    if (
      actionFilter &&
      !e.action.toLowerCase().includes(actionFilter.toLowerCase())
    )
      return false;
    if (sessionFilter && e.sessionId !== sessionFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <input
          placeholder="Filter by username"
          className={inputClass}
          value={usernameFilter}
          onChange={(e) => setUsernameFilter(e.target.value)}
        />
        <input
          placeholder="Filter by action (e.g. host.delete)"
          className={inputClass}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />
      </div>

      {sessionFilter && (
        <button
          onClick={() => setSessionFilter(null)}
          className="self-start rounded border border-border-strong px-2 py-1 text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink"
        >
          Shell session {shortSession(sessionFilter)} &times; clear
        </button>
      )}

      {loading ? (
        <div className="text-xs text-ink-faint">Loading...</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.length === 0 && (
            <div className="text-xs text-ink-faint">No matching entries.</div>
          )}
          {filtered.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-0.5 rounded border border-border bg-surface px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-ink">
                  {e.action}
                </span>
                <div className="flex items-center gap-2">
                  {e.sessionId && (
                    <button
                      onClick={() => setSessionFilter(e.sessionId ?? null)}
                      title="Show only this shell session"
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-faint hover:border-border-strong hover:text-ink"
                    >
                      {shortSession(e.sessionId)}
                    </button>
                  )}
                  <span className="text-[10px] text-ink-faint">
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="break-words text-[11px] text-ink-faint">
                {e.username || "system"}
                {e.targetLabel && (
                  <>
                    {" "}
                    &rarr;{" "}
                    <span className="text-ink-muted">{e.targetLabel}</span>
                  </>
                )}
                {e.detail && (
                  <span className="ml-2 font-mono text-ink-faint">
                    {e.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
