import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Host, Service, Vpn } from "../../types";
import type { PingStatus } from "../../hooks/usePingStatus";
import { buildGraphLayout } from "./layout";
import { VpnNode } from "./nodes/VpnNode";
import { HostNode } from "./nodes/HostNode";
import { ServiceNode } from "./nodes/ServiceNode";
import type { SelectedNode } from "../../types";

const nodeTypes = { vpn: VpnNode, host: HostNode, service: ServiceNode };

interface InfraGraphProps {
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  pingStatus: Record<string, PingStatus>;
  selected: SelectedNode | null;
  onSelect: (node: SelectedNode | null) => void;
}

export function InfraGraph({
  vpns,
  hosts,
  services,
  pingStatus,
  selected,
  onSelect,
}: InfraGraphProps) {
  const layout = useMemo(
    () => buildGraphLayout(vpns, hosts, services, pingStatus),
    [vpns, hosts, services, pingStatus],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // Re-sync when the underlying infra data changes shape (new/removed
  // resources); manual drag positions from the user are preserved via
  // useNodesState's internal diffing keyed on node id.
  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const selectedNodeId = selected
    ? `${selected.kind}-${selected.id}`
    : undefined;

  const displayNodes: Node[] = nodes.map((n) => ({
    ...n,
    selected: n.id === selectedNodeId,
  }));

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => {
        const [kind, ...rest] = node.id.split("-");
        onSelect({ kind: kind as SelectedNode["kind"], id: rest.join("-") });
      }}
      onPaneClick={() => onSelect(null)}
      className="bg-canvas"
      colorMode="dark"
      fitView
      minZoom={0.3}
      maxZoom={1.5}
    >
      <Background variant={BackgroundVariant.Dots} color="#222222" gap={24} />
      <Controls
        className="!border !border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!fill-ink [&>button]:hover:!bg-surface"
        showInteractive={false}
      />
    </ReactFlow>
  );
}
