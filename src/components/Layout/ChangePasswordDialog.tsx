import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { api } from "../../lib/api";

/**
 * Lets the signed-in account change its own password.
 *
 * Deliberately not part of the admin panel: a read-only user has no business
 * in there but every bit as much need to rotate their own password.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Checked here only to spare a round trip on an obvious typo; the rules
  // that matter (current password correct, new one long enough and actually
  // different) are enforced by the server, which is the only side that can.
  const mismatch = confirm !== "" && next !== confirm;
  const canSubmit =
    current !== "" && next !== "" && next === confirm && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await api.users.changeOwnPassword(current, next);
      setDone(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-full max-w-md flex-col rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound size={13} className="text-ink-faint" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink">
              Change Password
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-ink-faint transition-colors hover:text-ink"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs text-ink-muted">
              Password changed. Any other session signed in as you has been
              logged out; this one stays open.
            </p>
            <button
              onClick={onClose}
              className="self-end rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted transition-colors hover:text-ink"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
            <Field
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoFocus
            />
            <Field label="New password" value={next} onChange={setNext} />
            <Field
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
            />

            {mismatch && (
              <p className="text-[11px] text-amber-400">
                The two new passwords don't match.
              </p>
            )}
            {error && (
              <p className="break-words text-[11px] text-red-400">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {saving ? "Saving..." : "Change Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
        {label}
      </span>
      <input
        type="password"
        value={value}
        autoFocus={autoFocus}
        // Tells a password manager this is a change-password form rather
        // than a login, so it offers to update the stored entry.
        autoComplete={label.startsWith("Current") ? "current-password" : "new-password"}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-border-strong"
      />
    </label>
  );
}
