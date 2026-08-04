import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Host, HostMetricsResponse } from "../types";
import type { PingStatus } from "./usePingStatus";

// Far slower than the ping poll: each collection is a full SSH connect plus
// a one-second sample window on the remote, so this is deliberately cheap on
// the hosts rather than real-time. The backend caches on its own TTL too, so
// extra tabs cost nothing.
const POLL_INTERVAL_MS =
  Number(import.meta.env.VITE_METRICS_INTERVAL_MS) || 30_000;

export type HostMetricsMap = Record<string, HostMetricsResponse>;

/**
 * Polls resource metrics for every host that ping says is reachable.
 * Offline hosts are skipped entirely -- collecting from them would just
 * block on the SSH dial timeout for no result.
 */
export function useHostMetrics(
  hosts: Host[],
  pingStatus: Record<string, PingStatus>,
) {
  const [metrics, setMetrics] = useState<HostMetricsMap>({});

  // Kept in refs so changing ping state doesn't restart the poll timer --
  // only the set of hosts does.
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const pingRef = useRef(pingStatus);
  pingRef.current = pingStatus;

  // Keyed on the *online* set: a host coming up triggers a collection
  // immediately instead of waiting out the current poll interval, and the
  // key is stable once ping settles so the timer isn't churning.
  const onlineIds = hosts
    .filter((h) => pingStatus[h.id] === "online")
    .map((h) => h.id)
    .join(",");

  useEffect(() => {
    let cancelled = false;

    async function collectAll() {
      await Promise.all(
        hostsRef.current.map(async (host) => {
          if (pingRef.current[host.id] !== "online") return;
          try {
            const result = await api.hosts.metrics(host.id);
            if (!cancelled) {
              setMetrics((prev) => ({ ...prev, [host.id]: result }));
            }
          } catch {
            // Leave the last good reading in place; the card shows its age.
          }
        }),
      );
    }

    collectAll();
    const interval = setInterval(collectAll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onlineIds]);

  return metrics;
}

/** The highest of the three percentages -- what the node's dot reflects. */
export function worstPercent(m: HostMetricsResponse): number {
  return Math.max(m.cpuPercent, m.memPercent, m.diskPercent);
}

export type MetricLevel = "ok" | "warn" | "critical";

export function metricLevel(percent: number): MetricLevel {
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warn";
  return "ok";
}

export function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${kb} KB`;
}

export function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
