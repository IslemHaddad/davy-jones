import type { Edge, Node } from "@xyflow/react";
import type { Host, Service, Vpn } from "../../types";
import type { PingStatus } from "../../hooks/usePingStatus";
import type { HostMetricsMap } from "../../hooks/useHostMetrics";
import type { ServiceStatusMap } from "../../hooks/useServiceStatus";
import type { NodeAction } from "../../lib/nodeCommands";

import type { VpnNodeData } from "./nodes/VpnNode";
import type { HostNodeData } from "./nodes/HostNode";
import type { ServiceNodeData } from "./nodes/ServiceNode";

/** Builds the hover-menu buttons for one node; supplied by the graph. */
export interface NodeActionBuilders {
  vpn: (vpn: Vpn) => NodeAction[];
  host: (host: Host) => NodeAction[];
  service: (service: Service) => NodeAction[];
}

const noActions: NodeActionBuilders = {
  vpn: () => [],
  host: () => [],
  service: () => [],
};

const COL_WIDTH = 260;
const ROW_Y = { vpn: 40, host: 220, service: 400 } as const;
const SERVICE_ROW_HEIGHT = 110;

/**
 * Lays out VPN -> Host -> Service as a three-tier tree.
 *
 * The one invariant here: every host and every service handed in gets a node,
 * whatever its links say. A node is the only evidence on this canvas that a
 * resource exists at all, so dropping one because a *reference* is broken
 * doesn't hide the broken link -- it hides the machine, which reads as "my
 * infrastructure disappeared" and sends you looking for the wrong problem.
 * Dangling references are drawn as detached instead (see `detached` below).
 */
export function buildGraphLayout(
  vpns: Vpn[],
  hosts: Host[],
  services: Service[],
  pingStatus: Record<string, PingStatus>,
  metrics: HostMetricsMap = {},
  serviceStatus: ServiceStatusMap = {},
  actions: NodeActionBuilders = noActions,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let col = 0;

  // A vpnId only counts as an attachment when that VPN is actually on this
  // canvas, and often it isn't: deleting a VPN doesn't clear the field on the
  // hosts that pointed at it, and a VPN owned by another project isn't
  // returned for this one. Such a host used to be filed under a VPN that the
  // loop below never visits, so it -- and every service beneath it -- was
  // silently left off the graph.
  const vpnIds = new Set(vpns.map((v) => v.id));
  const hostsByVpn = new Map<string, Host[]>();
  const looseHosts: Host[] = [];
  for (const h of hosts) {
    if (h.vpnId && vpnIds.has(h.vpnId)) {
      const arr = hostsByVpn.get(h.vpnId) ?? [];
      arr.push(h);
      hostsByVpn.set(h.vpnId, arr);
    } else {
      looseHosts.push(h);
    }
  }

  // Every service that has been drawn under its host. Whatever is left at the
  // end points at a host that isn't here (deleted, or in another project) and
  // gets its own stack rather than vanishing with it.
  const placedServices = new Set<string>();

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
      data: {
        host,
        pingStatus: pingStatus[host.id] ?? "checking",
        metrics: metrics[host.id],
        actions: actions.host(host),
        // Says "this host names a VPN that isn't here", which is a different
        // and much more findable problem than the host being absent.
        detached: Boolean(host.vpnId) && !vpnIds.has(host.vpnId as string),
      } satisfies HostNodeData,
    });

    const hostServices = servicesByHost.get(host.id) ?? [];
    hostServices.forEach((svc, i) => {
      placedServices.add(svc.id);
      const status = serviceStatus[svc.id];
      nodes.push({
        id: `service-${svc.id}`,
        type: "service",
        position: { x, y: ROW_Y.service + i * SERVICE_ROW_HEIGHT },
        data: {
          service: svc,
          status,
          // Status polling stops when a host stops answering, and the last
          // reading is kept rather than discarded -- so without this the
          // node would keep showing a green dot for a service nothing has
          // checked since the host went away.
          hostReachable: pingStatus[host.id] === "online",
          actions: actions.service(svc),
        } satisfies ServiceNodeData,
      });
      // A Swarm service is declared on the manager but its tasks run
      // wherever the scheduler put them, so "this host knows about it" and
      // "this host runs it" are different claims.
      //
      // Earlier this *deleted* the edge, which meant links silently vanished
      // 30-60s after load -- once the first status poll landed -- and read as
      // the graph breaking. Weakening the line says the same thing without
      // anything disappearing: the connection you configured stays visible,
      // drawn as provisional rather than asserted.
      const runsElsewhere = status?.found === true && !status.onThisHost;
      edges.push({
        id: `e-host-${host.id}-svc-${svc.id}`,
        source: `host-${host.id}`,
        target: `service-${svc.id}`,
        ...(runsElsewhere
          ? {
              label: status?.nodes?.length
                ? `runs on ${status.nodes.join(", ")}`
                : "runs elsewhere",
              style: { strokeDasharray: "4 4", opacity: 0.45 },
              labelStyle: { fontSize: 9 },
            }
          : {}),
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
        data: { vpn, actions: actions.vpn(vpn) } satisfies VpnNodeData,
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
      data: { vpn, actions: actions.vpn(vpn) } satisfies VpnNodeData,
    });
    for (const h of vpnHosts) {
      edges.push({
        id: `e-vpn-${vpn.id}-host-${h.id}`,
        source: `vpn-${vpn.id}`,
        target: `host-${h.id}`,
      });
    }
  }

  for (const h of looseHosts) {
    placeHost(h);
  }

  // Services left over from the sweep above: their hostId resolves to nothing
  // on this canvas. Stacked in one trailing column rather than dropped, for
  // the same reason detached hosts are still drawn.
  const strayX = col * COL_WIDTH;
  let strayRow = 0;
  for (const svc of services) {
    if (placedServices.has(svc.id)) continue;
    nodes.push({
      id: `service-${svc.id}`,
      type: "service",
      position: { x: strayX, y: ROW_Y.service + strayRow * SERVICE_ROW_HEIGHT },
      data: {
        service: svc,
        status: serviceStatus[svc.id],
        // Its host isn't on this canvas at all, so there is nothing whose
        // reachability could vouch for this reading.
        hostReachable: false,
        actions: actions.service(svc),
        detached: true,
      } satisfies ServiceNodeData,
    });
    strayRow += 1;
  }

  return { nodes, edges };
}
