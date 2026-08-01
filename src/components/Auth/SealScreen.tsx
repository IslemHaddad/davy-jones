import { useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export function SealScreen({ phase }: { phase: "needs-init" | "sealed" }) {
  const { sealStatus, freshShares, error, initializeSeal, submitShare } =
    useAuth();
  const [share, setShare] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function handleInitialize() {
    setSubmitting(true);
    try {
      await initializeSeal();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!share.trim() || submitting) return;
    setSubmitting(true);
    try {
      await submitShare(share.trim());
      setShare("");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyShare(s: string, i: number) {
    try {
      await navigator.clipboard.writeText(s);
      setCopiedIndex(i);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // clipboard access denied -- user can still select+copy manually
    }
  }

  if (phase === "needs-init") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface">
              <ShieldAlert size={22} className="text-vpn" />
            </div>
            <h1 className="text-sm font-semibold text-ink">
              Initialize Encryption
            </h1>
            <p className="text-center text-xs text-ink-faint">
              All infrastructure data (hosts, VPNs, services, SSH
              credentials) will be encrypted at rest. This generates a master
              key split into recovery shares — none of them are ever stored
              by the server.
            </p>
          </div>
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <button
            onClick={handleInitialize}
            disabled={submitting}
            className="w-full rounded bg-ink px-3 py-2 text-xs font-bold uppercase tracking-widest text-canvas disabled:opacity-40"
          >
            {submitting ? "Generating..." : "Generate Key Shares"}
          </button>
        </div>
      </div>
    );
  }

  const threshold = sealStatus?.threshold ?? 3;
  const totalShares = sealStatus?.totalShares ?? 5;
  const progress = sealStatus?.progress ?? 0;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface">
            <KeyRound size={22} className="text-host" />
          </div>
          <h1 className="text-sm font-semibold text-ink">Unseal Data</h1>
          <p className="text-center text-xs text-ink-faint">
            Enter {threshold} of the {totalShares} key shares to unlock
            encrypted infrastructure data for this session.
          </p>
        </div>

        {freshShares && (
          <div className="mb-6 rounded border border-vpn/40 bg-vpn-dim/10 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-vpn">
              Save these {totalShares} shares now — shown only once
            </p>
            <div className="flex flex-col gap-1.5">
              {freshShares.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5"
                >
                  <span className="flex-1 truncate font-mono text-[11px] text-ink">
                    {s}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyShare(s, i)}
                    className="text-ink-faint hover:text-ink"
                  >
                    {copiedIndex === i ? (
                      <Check size={13} />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-red-400">
              If you lose more than {totalShares - threshold} of these, the
              data is unrecoverable. Store them somewhere durable, not just
              this screen.
            </p>
          </div>
        )}

        <div className="mb-4 flex items-center gap-1.5">
          {Array.from({ length: threshold }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < progress ? "bg-host" : "bg-border"
              }`}
            />
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
          <input
            value={share}
            onChange={(e) => setShare(e.target.value)}
            placeholder="Paste a key share"
            autoFocus
            className="flex-1 rounded border border-border bg-surface px-2.5 py-2 font-mono text-xs text-ink outline-none focus:border-border-strong"
          />
          <button
            type="submit"
            disabled={submitting || !share.trim()}
            className="rounded bg-ink px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-canvas disabled:opacity-40"
          >
            Submit
          </button>
        </form>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
