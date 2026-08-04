import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Unlink } from "lucide-react";
import type { Service, ServiceStatus } from "../../../types";
import { NodeHoverMenu } from "./NodeHoverMenu";
import type { NodeAction } from "../../../lib/nodeCommands";

export type ServiceNodeData = {
  service: Service;
  status?: ServiceStatus;
  /**
   * Whether the host this service runs on is currently answering. False makes
   * `status` a last-known reading rather than a current one.
   */
  hostReachable?: boolean;
  actions?: NodeAction[];
  /** Names a host that isn't on this canvas; see buildGraphLayout. */
  detached?: boolean;
};

export function ServiceNode({
  data,
  selected,
}: NodeProps & { data: ServiceNodeData }) {
  const { service, status, hostReachable, actions, detached } = data;
  // Three states, not two. Red has to keep meaning "the host answered and
  // said this service is down" -- a real fault worth chasing. When the host
  // itself is unreachable nobody knows either way, and painting that red
  // would send someone after a service that may well be running fine, while
  // leaving the stale green up claims an all-clear nothing verified.
  const unknown = Boolean(status?.found) && !hostReachable;

  return (
    <NodeHoverMenu actions={actions ?? []} title={service.name}>
      <div
        className={`w-52 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors ${
          selected
            ? "border-service"
            : "border-border hover:border-border-strong"
        }`}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!h-2 !w-2 !border-none !bg-service"
        />
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-service-dim/40">
            <Box size={13} className="text-service" />
          </div>
          <span className="truncate text-xs font-semibold text-ink">
            {service.name}
          </span>
          {/* Only Docker services are polled, and only a host that actually
              answered gets a dot -- an absent dot means "not checked",
              which is different from "down" and shouldn't look like it. */}
          {status?.found && (
            <span
              className={`ml-auto h-2 w-2 shrink-0 rounded-full ${
                unknown
                  ? "bg-violet-400"
                  : status.running
                    ? "bg-emerald-400"
                    : "bg-red-500"
              }`}
              title={statusTitle(status, unknown)}
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="section-header text-service">Service</span>
          <span className="font-mono text-[11px] text-ink-muted">
            {service.type}
          </span>
        </div>
        {detached && (
          <div
            className="mt-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-400"
            title="This service points at a host that isn't in this project — the host may have been deleted or moved. Edit the service to re-link it."
          >
            <Unlink size={9} className="shrink-0" />
            No host link
          </div>
        )}
      </div>
    </NodeHoverMenu>
  );
}

function statusTitle(status: ServiceStatus, unknown: boolean): string {
  const last = status.state || (status.running ? "running" : "stopped");
  if (unknown) {
    return `Unknown — the host isn't reachable, so nothing has checked this service. Last seen: ${last}`;
  }
  const parts = [last];
  if (status.nodes?.length) parts.push(`node: ${status.nodes.join(", ")}`);
  if (!status.onThisHost && status.nodes?.length) {
    parts.push("running on another swarm node — not linked to this host");
  }
  return parts.join(" · ");
}
