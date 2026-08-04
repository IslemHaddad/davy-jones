import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Crosshair,
  Eye,
  LayoutGrid,
  Maximize2,
  MousePointerSquareDashed,
  RotateCcw,
  Trash2,
  Undo2,
  XSquare,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import type { Host, Service, Vpn } from "../../types";
import type { PingStatus } from "../../hooks/usePingStatus";
import type { HostMetricsMap } from "../../hooks/useHostMetrics";
import type { NodePositions } from "../../hooks/useGraphLayout";
import type { ServiceStatusMap } from "../../hooks/useServiceStatus";
import type { NodeActionBuilders } from "./layout";
import { useTheme } from "../../context/ThemeContext";
import { buildGraphLayout } from "./layout";
import {
  CanvasContextMenu,
  type ContextMenuItem,
  type ContextMenuState,
} from "./CanvasContextMenu";
import { VpnNode } from "./nodes/VpnNode";
import { HostNode } from "./nodes/HostNode";
import { ServiceNode } from "./nodes/ServiceNode";
import type { SelectedNode } from "../../types";

const nodeTypes = { vpn: VpnNode, host: HostNode, service: ServiceNode };

/** Node ids are `${kind}-${resourceId}`; resource ids contain "-" themselves. */
function parseNodeId(nodeId: string): SelectedNode {
  const [kind, ...rest] = nodeId.split("-");
  return { kind: kind as SelectedNode["kind"], id: rest.join("-") };
}

interface InfraGraphProps {
  vpns: Vpn[];
  hosts: Host[];
  services: Service[];
  pingStatus: Record<string, PingStatus>;
  metrics: HostMetricsMap;
  serviceStatus: ServiceStatusMap;
  /** Hover-menu buttons per node; see lib/nodeCommands.ts. */
  actions: NodeActionBuilders;
  selected: SelectedNode | null;
  onSelect: (node: SelectedNode | null) => void;
  /** Double-clicking a node opens its details, not just selects it. */
  onOpenDetails: (node: SelectedNode) => void;
  /** Positions saved for this project; override the automatic layout. */
  savedPositions: NodePositions;
  /** False until savedPositions has loaded -- see useGraphLayout. */
  layoutLoaded: boolean;
  onPositionsChange: (positions: NodePositions) => void;
  /** Right-click menu hooks into the terminal tray owned by Dashboard. */
  openTerminalCount: number;
  onCloseAllTerminals: () => void;
  /** False for read-only accounts, which the server refuses deletes from. */
  canDelete: boolean;
  onDeleteNode: (node: SelectedNode) => void;
}

export function InfraGraph({
  vpns,
  hosts,
  services,
  pingStatus,
  metrics,
  serviceStatus,
  actions,
  selected,
  onSelect,
  onOpenDetails,
  savedPositions,
  layoutLoaded,
  onPositionsChange,
  openTerminalCount,
  onCloseAllTerminals,
  canDelete,
  onDeleteNode,
}: InfraGraphProps) {
  const { theme } = useTheme();
  const layout = useMemo(
    () =>
      buildGraphLayout(
        vpns,
        hosts,
        services,
        pingStatus,
        metrics,
        serviceStatus,
        actions,
      ),
    [vpns, hosts, services, pingStatus, metrics, serviceStatus, actions],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // onNodeDragStop fires with the node React Flow moved, but we want the
  // whole map -- and reading `nodes` from the closure there would capture a
  // stale render's array.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Re-sync when the underlying infra data changes shape (new/removed
  // resources, ping status, etc). setNodes is a plain replace -- it does
  // NOT preserve anything on its own -- so a dragged node's position has
  // to be explicitly carried over here, keyed by id. Precedence is: the
  // position the node already has on screen (mid-session drags), then the
  // project's saved arrangement, then the automatic layout for nodes
  // nobody has ever placed.
  // The first pass after a project's layout arrives has to let the saved
  // positions win outright: useNodesState already seeded every node from the
  // automatic layout, so treating those as "existing" would pin the nodes to
  // it and the saved arrangement would never be applied. Reset whenever
  // layoutLoaded goes false again (i.e. on a project switch).
  const hydratedRef = useRef(false);
  if (!layoutLoaded) hydratedRef.current = false;

  useEffect(() => {
    if (!layoutLoaded) return;
    const hydrating = !hydratedRef.current;
    hydratedRef.current = true;

    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return layout.nodes.map((n) => {
        const saved = savedPositions[n.id];
        if (hydrating) return saved ? { ...n, position: saved } : n;
        const existing = prevById.get(n.id);
        if (existing) return { ...n, position: existing.position };
        return saved ? { ...n, position: saved } : n;
      });
    });
    setEdges(layout.edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, layoutLoaded, savedPositions]);

  // Persist on drag end rather than on every intermediate frame -- the hook
  // debounces too, but this keeps the interim positions out of it entirely.
  function handleNodeDragStop() {
    const next: NodePositions = {};
    for (const n of nodesRef.current) {
      next[n.id] = { x: n.position.x, y: n.position.y };
    }
    onPositionsChange(next);
  }

  // React Flow's zoom/fit helpers live on the instance. Captured via onInit
  // rather than useReactFlow() so this component doesn't have to be split
  // around a ReactFlowProvider just to reach them.
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Discards the saved arrangement and drops every node back onto the
  // generated layout. Both halves are needed: clearing the stored positions
  // alone would leave the nodes exactly where they are on screen.
  function resetLayout() {
    setNodes(layout.nodes);
    onPositionsChange({});
  }

  function viewItems(): ContextMenuItem[] {
    return [
      {
        label: "Zoom in",
        icon: <ZoomIn size={12} />,
        onSelect: () => flowRef.current?.zoomIn({ duration: 150 }),
      },
      {
        label: "Zoom out",
        icon: <ZoomOut size={12} />,
        onSelect: () => flowRef.current?.zoomOut({ duration: 150 }),
      },
      {
        label: "Zoom to fit",
        icon: <Maximize2 size={12} />,
        onSelect: () => flowRef.current?.fitView({ duration: 200, padding: 0.15 }),
      },
      {
        label: "Reset zoom",
        hint: "100%",
        icon: <Crosshair size={12} />,
        onSelect: () => flowRef.current?.zoomTo(1, { duration: 150 }),
      },
      {
        label: "Reset layout",
        icon: <LayoutGrid size={12} />,
        separated: true,
        onSelect: resetLayout,
      },
      {
        label: "Clear selection",
        icon: <MousePointerSquareDashed size={12} />,
        disabled: !selected,
        onSelect: () => onSelect(null),
      },
      {
        label: `Close all terminals${openTerminalCount ? ` (${openTerminalCount})` : ""}`,
        icon: <XSquare size={12} />,
        separated: true,
        disabled: openTerminalCount === 0,
        onSelect: onCloseAllTerminals,
      },
    ];
  }

  /** So the confirmation names the resource rather than its node id. */
  function nodeLabel(target: SelectedNode): string {
    const pools: Record<SelectedNode["kind"], { id: string; name: string }[]> = {
      vpn: vpns,
      host: hosts,
      service: services,
    };
    return pools[target.kind].find((r) => r.id === target.id)?.name ?? target.id;
  }

  /**
   * Deleting a host takes its services with it (the server cascades), so the
   * confirmation says so before the click rather than after -- the count is
   * the whole reason someone might change their mind.
   */
  function cascadeNote(target: SelectedNode): string {
    if (target.kind !== "host") return "";
    const n = services.filter((s) => s.hostId === target.id).length;
    if (n === 0) return "";
    return ` + ${n} service${n === 1 ? "" : "s"}`;
  }

  // Deleting a host or a VPN takes its services' link with it and can't be
  // undone, and this menu opens directly under the pointer -- so the first
  // click only arms it. The second one, which names what is about to go, is
  // the one that deletes. The sidebar's trash icon deletes outright; that
  // button takes a deliberate trip through the details panel to reach, while
  // this one sits on the view people leave open all day.
  function armDelete(target: SelectedNode) {
    setMenu((prev) =>
      prev
        ? {
            ...prev,
            items: [
              {
                label: `Delete "${nodeLabel(target)}"${cascadeNote(target)}`,
                icon: <Trash2 size={12} />,
                danger: true,
                onSelect: () => onDeleteNode(target),
              },
              {
                label: "Cancel",
                icon: <Undo2 size={12} />,
                separated: true,
                onSelect: () => {},
              },
            ],
          }
        : prev,
    );
  }

  // React Flow hands these back as either a native or a synthetic event
  // depending on where the right-click landed, and both carry clientX/Y.
  type AnyMouseEvent = MouseEvent | React.MouseEvent;

  function openPaneMenu(e: AnyMouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: viewItems() });
  }

  function openNodeMenu(e: AnyMouseEvent, node: Node) {
    e.preventDefault();
    const target = parseNodeId(node.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Open details",
          icon: <Eye size={12} />,
          onSelect: () => onOpenDetails(target),
        },
        {
          label: "Reset position",
          icon: <RotateCcw size={12} />,
          onSelect: () => {
            const home = layout.nodes.find((n) => n.id === node.id);
            if (!home) return;
            const next: NodePositions = {};
            setNodes((prev) =>
              prev.map((n) => (n.id === node.id ? { ...n, position: home.position } : n)),
            );
            for (const n of nodesRef.current) {
              next[n.id] =
                n.id === node.id
                  ? { x: home.position.x, y: home.position.y }
                  : { x: n.position.x, y: n.position.y };
            }
            onPositionsChange(next);
          },
        },
        ...viewItems().map((item, i) => (i === 0 ? { ...item, separated: true } : item)),
        ...(canDelete
          ? [
              {
                label: `Delete ${target.kind}`,
                icon: <Trash2 size={12} />,
                separated: true,
                danger: true,
                // Stays open so the confirmation can take its place.
                keepOpen: true,
                onSelect: () => armDelete(target),
              },
            ]
          : []),
      ],
    });
  }

  const selectedNodeId = selected
    ? `${selected.kind}-${selected.id}`
    : undefined;

  const displayNodes: Node[] = nodes.map((n) => ({
    ...n,
    selected: n.id === selectedNodeId,
  }));

  return (
    <>
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(parseNodeId(node.id))}
      onNodeDoubleClick={(_, node) => onOpenDetails(parseNodeId(node.id))}
      onNodeDragStop={handleNodeDragStop}
      onPaneClick={() => onSelect(null)}
      onInit={(instance) => (flowRef.current = instance)}
      onPaneContextMenu={openPaneMenu}
      onNodeContextMenu={openNodeMenu}
      // React Flow's own handler would otherwise swallow the right-click
      // before it reaches the pane/node handlers above.
      deleteKeyCode={null}
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
    <CanvasContextMenu state={menu} onClose={closeMenu} />
    </>
  );
}
