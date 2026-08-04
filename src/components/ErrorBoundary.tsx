import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Named in the message so it's clear which part of the UI failed. */
  area: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/**
 * Catches render-time exceptions so a crash shows what went wrong instead of
 * silently unmounting.
 *
 * Without this, one bad value -- a null where an array was expected, a field
 * the server didn't send -- takes the subtree down and leaves blank space
 * behind. Blank space is indistinguishable from "there is nothing here",
 * which is exactly the wrong thing to tell an operator looking at their
 * infrastructure.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep it in the console too, with the component stack, for anyone with
    // devtools open.
    console.error(`[${this.props.area}] crashed:`, error, info.componentStack);
    this.setState({ stack: info.componentStack ?? "" });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center overflow-auto p-8">
        <div className="max-w-2xl border-t-2 border-red-500 bg-surface p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-red-400">
            {this.props.area} stopped rendering
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            Something threw while drawing this. The rest of the app is still
            running — reloading usually clears it. If it keeps happening, the
            details below say why.
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all bg-canvas p-2 font-mono text-[10px] text-red-400">
            {error.message}
            {stack ? `\n${stack.trim().split("\n").slice(0, 6).join("\n")}` : ""}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => this.setState({ error: null, stack: "" })}
              className="rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded border border-border-strong px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-ink"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
