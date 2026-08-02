import { useState, type FormEvent } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export function LoginScreen({ mode }: { mode: "needs-setup" | "locked" }) {
  const { setup, login, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isSetup = mode === "needs-setup";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (username.trim().length === 0) {
      setLocalError("Username is required.");
      return;
    }
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
        await setup(username, password);
      } else {
        await login(username, password);
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
            {isSetup ? "Create Your Account" : "Unlock Control Center"}
          </h1>
          <p className="text-center text-xs text-ink-faint">
            {isSetup
              ? "This account protects local access to your infrastructure data. You can add more accounts later."
              : "Log in to continue."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-border-strong"
          />
          <input
            type="password"
            autoComplete={isSetup ? "new-password" : "current-password"}
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
            disabled={
              submitting || username.trim().length === 0 || password.length === 0
            }
            className="mt-2 rounded bg-ink px-3 py-2 text-xs font-bold uppercase tracking-widest text-canvas transition-opacity disabled:opacity-40"
          >
            {submitting ? "Please wait..." : isSetup ? "Create & Unlock" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
