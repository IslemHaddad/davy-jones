import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openTerminalSocket } from "../../lib/terminalSocket";

interface TerminalPaneProps {
  hostId: string;
  command?: string;
  active: boolean;
}

// One xterm.js instance + its own PTY WebSocket. Kept mounted (just hidden
// via the `active` flag) when its tab isn't focused, so switching tabs
// doesn't drop the connection or scrollback.
export function TerminalPane({ hostId, command, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace",
      theme: {
        background: "#050505",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        black: "#111111",
        brightBlack: "#666666",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const socket = openTerminalSocket(
      { hostId, command, cols: term.cols, rows: term.rows },
      {
        onOutput: (data) => term.write(data),
        onError: (message) =>
          term.write(`\r\n\x1b[31m[error] ${message}\x1b[0m\r\n`),
        onExit: () =>
          term.write(`\r\n\x1b[2m[process exited]\x1b[0m\r\n`),
      },
    );

    const dataSub = term.onData((data) => socket.sendInput(data));

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      socket.sendResize(term.cols, term.rows);
    });
    resizeObserver.observe(containerRef.current!);

    return () => {
      dataSub.dispose();
      resizeObserver.disconnect();
      socket.close();
      term.dispose();
    };
    // Each tab owns exactly one host/command for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={active ? "h-full w-full p-2" : "hidden h-full w-full p-2"}
    />
  );
}
