import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Network } from "lucide-react";
import type { Vpn } from "../../../types";

export type VpnNodeData = { vpn: Vpn };

export function VpnNode({ data, selected }: NodeProps & { data: VpnNodeData }) {
  const { vpn } = data;
  return (
    <div
      className={`w-56 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors ${
        selected ? "border-vpn" : "border-border hover:border-border-strong"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-vpn-dim/40">
          <Network size={13} className="text-vpn" />
        </div>
        <span className="truncate text-xs font-semibold text-ink">
          {vpn.name}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="section-header text-vpn">VPN</span>
        <span className="font-mono text-[11px] text-ink-muted">
          {vpn.remoteGateway}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-none !bg-vpn"
      />
    </div>
  );
}
