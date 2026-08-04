import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Gauge, Server, Unlink } from "lucide-react";
import type { Host, HostMetricsResponse } from "../../../types";
import type { PingStatus } from "../../../hooks/usePingStatus";
import {
  formatKb,
  metricLevel,
  worstPercent,
} from "../../../hooks/useHostMetrics";
import { LEVEL_TEXT } from "../../Monitoring/HostMonitoring";
import { NodeHoverMenu } from "./NodeHoverMenu";
import type { NodeAction } from "../../../lib/nodeCommands";

export type HostNodeData = {
  host: Host;
  pingStatus: PingStatus;
  metrics?: HostMetricsResponse;
  actions?: NodeAction[];
  /** Names a VPN that isn't on this canvas; see buildGraphLayout. */
  detached?: boolean;
};

export function HostNode({
  data,
  selected,
}: NodeProps & { data: HostNodeData }) {
  const { host, pingStatus, metrics, actions, detached } = data;
  const healthy = metrics && !metrics.error;
  const load = healthy ? worstPercent(metrics) : 0;

  return (
    <NodeHoverMenu
      actions={actions ?? []}
      title={host.name}
      header={
        healthy ? (
          <div className="font-mono text-[10px] text-ink-muted">
            <div>
              CPU {metrics.cpuPercent.toFixed(0)}% · RAM{" "}
              {metrics.memPercent.toFixed(0)}%
            </div>
            <div>
              DISK {metrics.diskPercent.toFixed(0)}% —{" "}
              {formatKb(metrics.diskUsedKb)} / {formatKb(metrics.diskTotalKb)}
            </div>
          </div>
        ) : undefined
      }
    >
    <div
      className={`relative w-56 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors ${
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
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Load: worst of CPU/RAM/disk, as a number rather than a second
              dot. A dot next to the reachability dot only says "something is
              a colour" and leaves you working out which is which; a gauge
              reading is self-describing at a glance. Detail lives in the
              hover menu and the sidebar. */}
          {healthy && (
            <span
              className={`flex items-center gap-0.5 font-mono text-[10px] leading-none ${
                LEVEL_TEXT[metricLevel(load)]
              }`}
              title={`Load ${load.toFixed(0)}% — highest of CPU ${metrics.cpuPercent.toFixed(0)}%, RAM ${metrics.memPercent.toFixed(0)}%, disk ${metrics.diskPercent.toFixed(0)}%`}
            >
              <Gauge size={10} className="shrink-0" />
              {load.toFixed(0)}%
            </span>
          )}
          <span
            className="relative flex h-2 w-2"
            title={`Host is ${pingStatus}`}
          >
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
      {detached && (
        <div
          className="mt-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-400"
          title="This host points at a VPN that isn't in this project — it may have been deleted, or it belongs to another project and hasn't been shared into this one. Edit the host to re-link or clear it."
        >
          <Unlink size={9} className="shrink-0" />
          No VPN link
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-none !bg-host"
      />
    </div>
    </NodeHoverMenu>
  );
}
