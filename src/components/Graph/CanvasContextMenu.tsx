import { useEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  label: string;
  /** Shown right-aligned, e.g. a keyboard shortcut hint. */
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
  icon?: ReactNode;
  /** Destructive: drawn in red so it doesn't read like the rest. */
  danger?: boolean;
  /**
   * Leaves the menu open after selecting, so an item can replace the menu's
   * contents -- how the delete confirmation is done without a modal.
   */
  keepOpen?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * A conventional right-click menu, positioned at the pointer.
 *
 * Dismisses the way people expect one to: click anywhere, Escape, another
 * right-click, scroll, or the window losing focus. It also flips itself back
 * inside the viewport near the right or bottom edge instead of being cut off.
 */
export function CanvasContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // `capture` so the menu closes before the click lands on whatever is
    // underneath it.
    document.addEventListener("mousedown", onClose, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onClose, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [state, onClose]);

  // Keep the menu on screen: measured after render, then nudged back inside.
  useEffect(() => {
    const el = ref.current;
    if (!state || !el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = state;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [state]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: state.x, top: state.y }}
      className="fixed z-50 w-56 rounded-lg border border-border bg-card p-1 shadow-xl"
      // Own right-clicks shouldn't reopen the menu on top of itself.
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item, i) => (
        <div key={item.label}>
          {item.separated && i > 0 && (
            <div className="my-1 border-t border-border" />
          )}
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              if (!item.keepOpen) onClose();
            }}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
              item.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-ink hover:bg-surface"
            }`}
          >
            {item.icon && (
              <span
                className={`shrink-0 ${item.danger ? "text-red-400" : "text-ink-faint"}`}
              >
                {item.icon}
              </span>
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="shrink-0 font-mono text-[9px] text-ink-faint">
                {item.hint}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
