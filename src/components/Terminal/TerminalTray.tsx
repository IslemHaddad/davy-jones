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

export function TerminalTray({
  tabs,
  activeId,
  collapsed,
  onSelect,
  onClose,
  onToggleCollapsed,
}: TerminalTrayProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex flex-col border-t border-border bg-surface">
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

      <div className={collapsed ? "h-0 overflow-hidden" : "h-80 overflow-hidden"}>
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
