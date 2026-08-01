import type { Edge, Node } from "@xyflow/react";
import type { Host, Service, Vpn } from "../../types";
import type { PingStatus } from "../../hooks/usePingStatus";
import type { VpnNodeData } from "./nodes/VpnNode";
import type { HostNodeData } from "./nodes/HostNode";
import type { ServiceNodeData } from "./nodes/ServiceNode";

const COL_WIDTH = 260;
const ROW_Y = { vpn: 40, host: 220, service: 400 } as const;
const SERVICE_ROW_HEIGHT = 110;

/**
 * Lays out VPN -> Host -> Service as a three-tier tree. Hosts without a
 * vpnId, and services, still render (as their own column / stack) so
 * nothing in the data is silently dropped from the canvas.
 */
export function buildGraphLayout(
  vpns: Vpn[],
  hosts: Host[],
  services: Service[],
  pingStatus: Record<string, PingStatus>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let col = 0;

  const hostsByVpn = new Map<string, Host[]>();
  const orphanHosts: Host[] = [];
  for (const h of hosts) {
    if (h.vpnId) {
      const arr = hostsByVpn.get(h.vpnId) ?? [];
      arr.push(h);
      hostsByVpn.set(h.vpnId, arr);
    } else {
      orphanHosts.push(h);
    }
  }

  const servicesByHost = new Map<string, Service[]>();
  for (const s of services) {
    const arr = servicesByHost.get(s.hostId) ?? [];
    arr.push(s);
    servicesByHost.set(s.hostId, arr);
  }

  function placeHost(host: Host): number {
    const x = col * COL_WIDTH;
    nodes.push({
      id: `host-${host.id}`,
      type: "host",
      position: { x, y: ROW_Y.host },
      data: { host, pingStatus: pingStatus[host.id] ?? "checking" } satisfies HostNodeData,
    });

    const hostServices = servicesByHost.get(host.id) ?? [];
    hostServices.forEach((svc, i) => {
      nodes.push({
        id: `service-${svc.id}`,
        type: "service",
        position: { x, y: ROW_Y.service + i * SERVICE_ROW_HEIGHT },
        data: { service: svc } satisfies ServiceNodeData,
      });
      edges.push({
        id: `e-host-${host.id}-svc-${svc.id}`,
        source: `host-${host.id}`,
        target: `service-${svc.id}`,
      });
    });

    col += 1;
    return x;
  }

  for (const vpn of vpns) {
    const vpnHosts = hostsByVpn.get(vpn.id) ?? [];
    if (vpnHosts.length === 0) {
      const x = col * COL_WIDTH;
      nodes.push({
        id: `vpn-${vpn.id}`,
        type: "vpn",
        position: { x, y: ROW_Y.vpn },
        data: { vpn } satisfies VpnNodeData,
      });
      col += 1;
      continue;
    }

    const hostXs = vpnHosts.map(placeHost);
    const centerX = hostXs.reduce((a, b) => a + b, 0) / hostXs.length;
    nodes.push({
      id: `vpn-${vpn.id}`,
      type: "vpn",
      position: { x: centerX, y: ROW_Y.vpn },
      data: { vpn } satisfies VpnNodeData,
    });
    for (const h of vpnHosts) {
      edges.push({
        id: `e-vpn-${vpn.id}-host-${h.id}`,
        source: `vpn-${vpn.id}`,
        target: `host-${h.id}`,
      });
    }
  }

  for (const h of orphanHosts) {
    placeHost(h);
  }

  return { nodes, edges };
}
