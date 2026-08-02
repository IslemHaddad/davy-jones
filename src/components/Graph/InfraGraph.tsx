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
import { useTheme } from "../../context/ThemeContext";
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
  const { theme } = useTheme();
  const layout = useMemo(
    () => buildGraphLayout(vpns, hosts, services, pingStatus),
    [vpns, hosts, services, pingStatus],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // Re-sync when the underlying infra data changes shape (new/removed
  // resources, ping status, etc). setNodes is a plain replace -- it does
  // NOT preserve anything on its own -- so a dragged node's position has
  // to be explicitly carried over from the previous node list here,
  // keyed by id; only genuinely new nodes get the freshly computed
  // default position.
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return layout.nodes.map((n) => {
        const existing = prevById.get(n.id);
        return existing ? { ...n, position: existing.position } : n;
      });
    });
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
      colorMode={theme}
      fitView
      minZoom={0.3}
      maxZoom={1.5}
    >
      <Background
        variant={BackgroundVariant.Dots}
        color={theme === "dark" ? "#222222" : "#d4d4d4"}
        gap={24}
      />
      <Controls
        className="!border !border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!fill-ink [&>button]:hover:!bg-surface"
        showInteractive={false}
      />
    </ReactFlow>
  );
}
