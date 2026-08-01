import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Server } from "lucide-react";
import type { Host } from "../../../types";
import type { PingStatus } from "../../../hooks/usePingStatus";

export type HostNodeData = { host: Host; pingStatus: PingStatus };

export function HostNode({
  data,
  selected,
}: NodeProps & { data: HostNodeData }) {
  const { host, pingStatus } = data;

  return (
    <div
      className={`w-56 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors ${
        selected ? "border-host" : "border-border hover:border-border-strong"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-none !bg-host"
      />
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-host-dim/40">
          <Server size={13} className="text-host" />
        </div>
        <span className="truncate text-xs font-semibold text-ink">
          {host.name}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="relative flex h-2 w-2">
            {pingStatus === "online" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                pingStatus === "online"
                  ? "bg-emerald-400"
                  : pingStatus === "checking"
                    ? "bg-ink-faint"
                    : "bg-red-500"
              }`}
            />
          </span>
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="section-header text-host">Host</span>
        <span className="font-mono text-[11px] text-ink-muted">
          {host.ip}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-none !bg-host"
      />
    </div>
  );
}
