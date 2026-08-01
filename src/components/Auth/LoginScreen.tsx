import { useState, type FormEvent } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export function LoginScreen({ mode }: { mode: "needs-setup" | "locked" }) {
  const { setup, login, error } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isSetup = mode === "needs-setup";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (isSetup) {
      if (password.length < 6) {
        setLocalError("Password must be at least 6 characters long.");
        return;
      }
      if (password !== confirm) {
        setLocalError("Passwords do not match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isSetup) {
        await setup(password);
      } else {
        await login(password);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface">
            {isSetup ? (
              <ShieldCheck size={22} className="text-vpn" />
            ) : (
              <Lock size={22} className="text-ink-muted" />
            )}
          </div>
          <h1 className="text-sm font-semibold text-ink">
            {isSetup ? "Create Admin Password" : "Unlock Control Center"}
          </h1>
          <p className="text-center text-xs text-ink-faint">
            {isSetup
              ? "This password protects local access to your infrastructure data."
              : "Enter your admin password to continue."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-border-strong"
          />
          {isSetup && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-border-strong"
            />
          )}

          {(localError || error) && (
            <p className="text-xs text-red-400">{localError ?? error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="mt-2 rounded bg-ink px-3 py-2 text-xs font-bold uppercase tracking-widest text-canvas transition-opacity disabled:opacity-40"
          >
            {submitting ? "Please wait..." : isSetup ? "Create & Unlock" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
