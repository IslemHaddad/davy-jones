import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "lucide-react";
import type { NodeAction } from "../../../lib/nodeCommands";

// Opening is delayed slightly so simply crossing a node on the way somewhere
// else doesn't flash a menu. Closing is delayed much longer, because that's
// the annoying failure: the menu vanishing while you're still travelling
// towards it.
const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 450;

/**
 * Wraps a graph node so hovering it reveals a menu of one-click commands.
 *
 * The menu stays open while the pointer is anywhere over the node *or* the
 * menu, and the two are joined by an invisible bridge spanning the gap
 * between them -- without it, the pointer would leave the node while
 * crossing that gap and the menu would close underneath the cursor. Closing
 * is on a timer as well, so a brief wobble outside the area doesn't dismiss
 * it; it fades rather than disappearing.
 */
export function NodeHoverMenu({
  actions,
  title,
  header,
  children,
}: {
  actions: NodeAction[];
  title: string;
  /** Optional readout shown above the buttons (e.g. a host's live metrics). */
  header?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function schedule(next: boolean, delay: number) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(next), delay);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (actions.length === 0 && !header) return <>{children}</>;

  return (
    <div
      className="relative"
      onPointerEnter={() => schedule(true, OPEN_DELAY_MS)}
      onPointerLeave={() => schedule(false, CLOSE_DELAY_MS)}
    >
      {children}

      {/* Bridge: covers the gap between node and menu so the pointer never
          leaves the hover area on the way across. */}
      <div
        className={`absolute left-0 top-full h-3 w-full ${
          open ? "" : "pointer-events-none"
        }`}
      />

      <div
        className={`absolute left-1/2 top-full z-30 mt-3 w-56 -translate-x-1/2 rounded-lg border border-border bg-card p-1.5 shadow-xl transition-all duration-200 ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="truncate px-1.5 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-ink-faint">
          {title}
        </div>
        {header && (
          <div className="mb-1 border-b border-border px-1.5 pb-1.5">
            {header}
          </div>
        )}
        <div className="flex flex-col">
          {actions.map((action) => (
            <button
              key={action.label}
              // nodrag/nopan keep React Flow from treating a click in the
              // menu as the start of a canvas drag.
              className="nodrag nopan flex flex-col items-start gap-0.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-surface"
              // The subtitle is abbreviated for the ones that resolve a
              // service to its containers first; the title shows the real
              // thing so nothing is hidden.
              title={action.command || undefined}
              onClick={(e) => {
                e.stopPropagation();
                action.run();
              }}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-ink">
                <Terminal size={10} className="shrink-0 text-ink-faint" />
                {action.label}
              </span>
              {(action.summary || action.command) && (
                <span className="w-full truncate pl-[18px] font-mono text-[9px] text-ink-faint">
                  {action.summary ?? action.command}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
