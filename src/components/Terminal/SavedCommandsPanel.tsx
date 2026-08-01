import { useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import type { SavedCommand } from "../../types";

interface SavedCommandsPanelProps {
  hostId: string;
  commands: SavedCommand[];
  onCreate: (cmd: Omit<SavedCommand, "id">) => Promise<void>;
  onDelete: (id: string) => void;
  onRun: (command: string, name: string) => void;
}

export function SavedCommandsPanel({
  hostId,
  commands,
  onCreate,
  onDelete,
  onRun,
}: SavedCommandsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");

  async function handleAdd() {
    if (!name.trim() || !command.trim()) return;
    await onCreate({ hostId, name: name.trim(), command: command.trim() });
    setName("");
    setCommand("");
    setAdding(false);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="section-header">Saved Commands</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-ink-faint hover:text-ink"
          title="Add saved command"
        >
          <Plus size={13} />
        </button>
      </div>

      {commands.length === 0 && !adding && (
        <p className="text-xs text-ink-faint">
          No saved commands yet. e.g. "Tail nginx" →{" "}
          <span className="font-mono">docker logs -f nginx</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5"
          >
            <button
              onClick={() => onRun(cmd.command, cmd.name)}
              className="text-ink-faint hover:text-vpn"
              title="Run"
            >
              <Play size={12} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink">{cmd.name}</div>
              <div className="truncate font-mono text-[11px] text-ink-faint">
                {cmd.command}
              </div>
            </div>
            <button
              onClick={() => onDelete(cmd.id)}
              className="text-ink-faint hover:text-red-400"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-2 flex flex-col gap-1.5 rounded border border-border bg-surface p-2.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Tail nginx)"
            className="rounded border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-border-strong"
          />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="docker logs -f nginx"
            className="rounded border border-border bg-canvas px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-border-strong"
          />
          <button
            onClick={handleAdd}
            disabled={!name.trim() || !command.trim()}
            className="rounded bg-ink px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-canvas disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
