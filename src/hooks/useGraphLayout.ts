import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { NodePosition } from "../types";

// Dragging fires a stream of position updates; saving each one would mean a
// request (and a full file re-encrypt) per animation frame. Positions are
// coalesced and flushed once the canvas settles.
const SAVE_DEBOUNCE_MS = 600;

export type NodePositions = Record<string, NodePosition>;

/**
 * Loads a project's saved node arrangement and writes changes back.
 *
 * `loaded` matters to the graph: until the saved positions have arrived
 * there is nothing to distinguish "this project has no layout" from "the
 * layout hasn't loaded yet", and applying the automatic layout in the
 * meantime would visibly snap the nodes around on every page load.
 */
export function useGraphLayout(projectId: string) {
  const [positions, setPositions] = useState<NodePositions>({});
  const [loaded, setLoaded] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<NodePositions | null>(null);
  // Read inside the debounced flush so a project switch mid-timer can't
  // write one project's arrangement onto another.
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    api.layout
      .get(projectId)
      .then((layout) => {
        if (cancelled) return;
        setPositions(layout.positions ?? {});
        setLoaded(true);
      })
      .catch(() => {
        // A failed load just means "no saved arrangement" -- the automatic
        // layout still renders a usable graph.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    // Read-only accounts are refused by the server here; their drags stay
    // local to the session, which is the intended behaviour rather than an
    // error worth surfacing.
    api.layout.save(projectRef.current, pending).catch(() => {});
  }, []);

  const savePositions = useCallback(
    (next: NodePositions) => {
      setPositions(next);
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Don't lose the last drag to an unmount or a project switch.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      flush();
    };
  }, [flush, projectId]);

  return { positions, loaded, savePositions };
}
