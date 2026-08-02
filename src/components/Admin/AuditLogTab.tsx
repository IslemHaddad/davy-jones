import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { AuditEntry } from "../../types";
import { inputClass } from "../Layout/AddResourcesPanel";

export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [usernameFilter, setUsernameFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

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
                <span className="text-[10px] text-ink-faint">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="truncate text-[11px] text-ink-faint">
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
