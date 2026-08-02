import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Host } from "../types";

const POLL_INTERVAL_MS = Number(import.meta.env.VITE_PING_INTERVAL_MS) || 5_000;

export type PingStatus = "online" | "offline" | "checking";

/** Polls TCP-reachability for every host on a fixed interval. */
export function usePingStatus(hosts: Host[]) {
  const [status, setStatus] = useState<Record<string, PingStatus>>({});
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  useEffect(() => {
    let cancelled = false;

    async function pingAll() {
      const current = hostsRef.current;
      await Promise.all(
        current.map(async (host) => {
          try {
            const { online } = await api.hosts.ping(host.id);
            const next: PingStatus = online ? "online" : "offline";
            if (!cancelled) {
              setStatus((prev) =>
                prev[host.id] === next ? prev : { ...prev, [host.id]: next },
              );
            }
          } catch {
            if (!cancelled) {
              setStatus((prev) =>
                prev[host.id] === "offline" ? prev : { ...prev, [host.id]: "offline" },
              );
            }
          }
        }),
      );
    }

    pingAll();
    const interval = setInterval(pingAll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hosts.map((h) => h.id).join(",")]);

  return status;
}
