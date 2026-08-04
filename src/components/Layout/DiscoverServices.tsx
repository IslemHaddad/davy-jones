import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../lib/api";
import type { DiscoveryResult, Host, Service } from "../../types";
import { Field, inputClass } from "./AddResourcesPanel";

/** Types the backend knows how to enumerate (see backend/discovery.go). */
const DISCOVERABLE = ["Docker", "LXC"];

/**
 * Asks a host what it's already running and offers the results as services
 * to add. Names already registered on that host are shown but unchecked, so
 * running discovery twice doesn't create duplicates.
 */
export function DiscoverServices({
  hosts,
  services,
  onCreate,
}: {
  hosts: Host[];
  services: Service[];
  onCreate: (service: Omit<Service, "id">) => Promise<void>;
}) {
  const [hostId, setHostId] = useState("");
  const [type, setType] = useState(DISCOVERABLE[0]);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  const existingOnHost = new Set(
    services.filter((s) => s.hostId === hostId).map((s) => s.name),
  );

  async function handleScan() {
    setBusy(true);
    setError(null);
    setAdded(null);
    setResult(null);
    try {
      const res = await api.hosts.discoverServices(hostId, type);
      setResult(res);
      // Pre-select only what isn't already recorded -- the common case is
      // "show me what's new since last time".
      setSelected(new Set(res.names.filter((n) => !existingOnHost.has(n))));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      const names = [...selected];
      for (const name of names) {
        await onCreate({ name, type, hostId });
      }
      setAdded(names.length);
      setResult(null);
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-surface p-2.5">
      <div className="section-header flex items-center gap-1.5">
        <Search size={11} />
        Discover From Host
      </div>

      <Field label="Host">
        <select
          className={inputClass}
          value={hostId}
          onChange={(e) => {
            setHostId(e.target.value);
            setResult(null);
            setAdded(null);
          }}
        >
          <option value="">Select host</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Type">
        <select
          className={inputClass}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setResult(null);
            setAdded(null);
          }}
        >
          {DISCOVERABLE.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="mt-1 text-[10px] leading-relaxed text-ink-faint">
          Runs <code>{type === "Docker" ? "docker service ls" : "lxc list"}</code>{" "}
          on the host over SSH and offers what it finds. Node services have no
          registry to list, so they're still added by hand.
        </span>
      </Field>

      <button
        type="button"
        onClick={handleScan}
        disabled={!hostId || busy}
        className="rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Scanning…" : "Scan Host"}
      </button>

      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {added !== null && (
        <p className="text-[11px] text-emerald-400">
          Added {added} service{added === 1 ? "" : "s"}.
        </p>
      )}

      {result?.error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-400">
          <pre className="whitespace-pre-wrap break-all">{result.error}</pre>
        </div>
      )}

      {result && !result.error && result.names.length === 0 && (
        <p className="text-[11px] text-ink-faint">
          Nothing found. The host answered, but reported no {type} services.
        </p>
      )}

      {result && result.names.length > 0 && (
        <>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-border bg-card p-2">
            {result.names.map((name) => {
              const known = existingOnHost.has(name);
              return (
                <label
                  key={name}
                  className="flex items-center gap-2 text-xs text-ink"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => toggle(name)}
                  />
                  <span className="truncate font-mono">{name}</span>
                  {known && (
                    <span className="ml-auto shrink-0 text-[9px] uppercase tracking-widest text-ink-faint">
                      already added
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={selected.size === 0 || busy}
            className="rounded border border-border-strong bg-card px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add {selected.size} Selected
          </button>
        </>
      )}
    </div>
  );
}
