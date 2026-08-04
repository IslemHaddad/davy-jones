import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Service, ServiceStatus } from "../types";
import type { PingStatus } from "./usePingStatus";

// One SSH connection per host per round, same cost profile as metrics -- so
// the same relaxed cadence rather than the 5s ping.
const POLL_INTERVAL_MS =
  Number(import.meta.env.VITE_SERVICE_STATUS_INTERVAL_MS) || 30_000;

/** Keyed by service id, not name -- names are only unique within a host. */
export type ServiceStatusMap = Record<string, ServiceStatus>;

/**
 * Polls Docker service state for every Docker service on a reachable host.
 *
 * Only Docker is polled: LXC and Node services have no equivalent status
 * command wired up, and asking would just cost an SSH connection to learn
 * nothing.
 */
export function useServiceStatus(
  services: Service[],
  pingStatus: Record<string, PingStatus>,
) {
  const [statuses, setStatuses] = useState<ServiceStatusMap>({});

  const servicesRef = useRef(services);
  servicesRef.current = services;
  const pingRef = useRef(pingStatus);
  pingRef.current = pingStatus;
  // Host ids the server says don't exist; cleared whenever the service set
  // changes, so a re-added host is picked up again.
  const deadHosts = useRef<Set<string>>(new Set());

  // Restart the timer when the set of (online host, docker service) pairs
  // changes, so a newly reachable host is checked right away.
  const key = services
    .filter((s) => s.type === "Docker" && pingStatus[s.hostId] === "online")
    .map((s) => `${s.hostId}:${s.id}`)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;
    deadHosts.current = new Set();

    async function checkAll() {
      const byHost = new Map<string, Service[]>();
      for (const s of servicesRef.current) {
        if (s.type !== "Docker") continue;
        if (pingRef.current[s.hostId] !== "online") continue;
        if (deadHosts.current.has(s.hostId)) continue;
        const list = byHost.get(s.hostId) ?? [];
        list.push(s);
        byHost.set(s.hostId, list);
      }

      await Promise.all(
        [...byHost.entries()].map(async ([hostId, hostServices]) => {
          try {
            const results = await api.hosts.serviceStatus(
              hostId,
              hostServices.map((s) => s.name),
            );
            if (cancelled) return;
            // The API answers by name; map back onto ids so two hosts with
            // a service of the same name don't collide.
            const byName = new Map(results.map((r) => [r.name, r]));
            setStatuses((prev) => {
              const next = { ...prev };
              for (const s of hostServices) {
                const found = byName.get(s.name);
                if (found) next[s.id] = found;
              }
              return next;
            });
          } catch (e) {
            // A host that no longer exists (deleted, or a stale id left in a
            // list this poll started with) answers 404 forever. Drop it for
            // the rest of this poll cycle instead of retrying it every 30s;
            // the next data reload rebuilds the set from scratch.
            if (String(e).includes("host not found")) {
              deadHosts.current.add(hostId);
            }
            // Otherwise keep the previous reading -- a blip shouldn't blank
            // the graph.
          }
        }),
      );
    }

    checkAll();
    const interval = setInterval(checkAll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [key]);

  return statuses;
}
