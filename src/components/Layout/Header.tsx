import { Anchor, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export function Header() {
  const { logout } = useAuth();

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2">
        <Anchor size={14} className="text-ink-muted" />
        <span className="text-xs font-semibold tracking-wide text-ink">
          Davy Jones
        </span>
      </div>
      <button
        onClick={() => logout()}
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
      >
        <LogOut size={12} />
        Lock
      </button>
    </header>
  );
}
