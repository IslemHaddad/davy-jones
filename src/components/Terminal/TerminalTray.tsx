import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ChevronDown, ChevronUp, SquareTerminal, X } from "lucide-react";
import type { TerminalTab } from "../../types";
import { TerminalPane } from "./TerminalPane";

interface TerminalTrayProps {
  tabs: TerminalTab[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onToggleCollapsed: () => void;
}

const HEIGHT_KEY = "dcc_terminal_height";
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 120;
// Room always left above the tray for the header and some of the canvas, so
// the tray can't be dragged over the whole window.
const RESERVED_TOP = 160;
const KEY_STEP = 24;

function clampHeight(h: number): number {
  const max = Math.max(MIN_HEIGHT, window.innerHeight - RESERVED_TOP);
  return Math.round(Math.min(Math.max(h, MIN_HEIGHT), max));
}

function storedHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    if (n > 0) return clampHeight(n);
  } catch {
    // Storage unavailable (private mode, blocked): use the default.
  }
  return clampHeight(DEFAULT_HEIGHT);
}

export function TerminalTray({
  tabs,
  activeId,
  collapsed,
  onSelect,
  onClose,
  onToggleCollapsed,
}: TerminalTrayProps) {
  const [height, setHeight] = useState(storedHeight);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      // Not persisting the height is harmless.
    }
  }, [height]);

  // A window that gets shorter mustn't leave the tray taller than it.
  useEffect(() => {
    const onResize = () => setHeight((h) => clampHeight(h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Pointer capture keeps the drag going when the cursor crosses the xterm
  // canvas or leaves the window, and the tray grows as the handle moves up.
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startHeight: height };
    document.body.style.userSelect = "none";
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setHeight(clampHeight(drag.current.startHeight + drag.current.startY - e.clientY));
  }
  function endDrag() {
    drag.current = null;
    document.body.style.userSelect = "";
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowUp") setHeight((h) => clampHeight(h + KEY_STEP));
    else if (e.key === "ArrowDown") setHeight((h) => clampHeight(h - KEY_STEP));
    else return;
    e.preventDefault();
  }

  if (tabs.length === 0) return null;

  return (
    <div className="relative flex flex-col border-t border-border bg-surface">
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          aria-valuenow={height}
          aria-valuemin={MIN_HEIGHT}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setHeight(clampHeight(DEFAULT_HEIGHT))}
          onKeyDown={onKeyDown}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none transition-colors hover:bg-host/40 focus-visible:bg-host/40 active:bg-host/60"
        />
      )}
      <div className="flex h-9 shrink-0 items-center border-b border-border pl-2 pr-1">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={`group flex shrink-0 items-center gap-1.5 rounded-t px-2.5 py-1.5 text-xs transition-colors ${
                tab.id === activeId
                  ? "bg-card text-ink"
                  : "text-ink-faint hover:text-ink-muted"
              }`}
            >
              <SquareTerminal size={12} />
              <span className="whitespace-nowrap">{tab.label}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="rounded opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                <X size={12} />
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onToggleCollapsed}
          className="p-1.5 text-ink-faint hover:text-ink"
          title={collapsed ? "Expand terminal" : "Collapse terminal"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <div
        className="overflow-hidden"
        style={{ height: collapsed ? 0 : height }}
      >
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            hostId={tab.hostId}
            command={tab.command}
            active={tab.id === activeId}
          />
        ))}
      </div>
    </div>
  );
}
