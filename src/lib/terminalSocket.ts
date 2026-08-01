import { getAuthToken } from "./api";

export interface TerminalHandlers {
  onReady?: () => void;
  onOutput: (data: Uint8Array) => void;
  onError?: (message: string) => void;
  onExit?: () => void;
  onClose?: () => void;
}

export interface TerminalSocket {
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  close: () => void;
}

/**
 * Opens the shared PTY WebSocket: no `command` starts an interactive shell,
 * a `command` streams that command's output instead (used for saved/named
 * commands like `kubectl logs -f`). The first message must authenticate --
 * see backend/terminal.go -- since browsers can't set custom headers on a
 * WebSocket handshake.
 */
export function openTerminalSocket(
  opts: { hostId: string; command?: string; cols: number; rows: number },
  handlers: TerminalHandlers,
): TerminalSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/ws/ssh/session`);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "auth",
        token: getAuthToken() ?? "",
        hostId: opts.hostId,
        command: opts.command,
        cols: opts.cols,
        rows: opts.rows,
      }),
    );
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "error") handlers.onError?.(msg.message);
        else if (msg.type === "exit") handlers.onExit?.();
        else if (msg.type === "ready") handlers.onReady?.();
      } catch {
        // malformed control message -- ignore
      }
      return;
    }
    handlers.onOutput(new Uint8Array(event.data as ArrayBuffer));
  });

  ws.addEventListener("close", () => handlers.onClose?.());

  return {
    sendInput: (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    },
    sendResize: (cols, rows) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    },
    close: () => ws.close(),
  };
}
