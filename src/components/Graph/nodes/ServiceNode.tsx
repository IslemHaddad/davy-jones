import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box } from "lucide-react";
import type { Service } from "../../../types";

export type ServiceNodeData = { service: Service };

export function ServiceNode({
  data,
  selected,
}: NodeProps & { data: ServiceNodeData }) {
  const { service } = data;
  return (
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
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="section-header text-service">Service</span>
        <span className="font-mono text-[11px] text-ink-muted">
          {service.type}
        </span>
      </div>
    </div>
  );
}
