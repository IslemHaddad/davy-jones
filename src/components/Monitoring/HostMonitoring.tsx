import { Activity } from "lucide-react";
import type { HostMetricsResponse, MetricSample } from "../../types";
import {
  formatKb,
  formatUptime,
  metricLevel,
  type MetricLevel,
} from "../../hooks/useHostMetrics";

const LEVEL_BAR: Record<MetricLevel, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  critical: "bg-red-500",
};

/**
 * Text colour per level, shared with the graph node's load readout.
 *
 * "ok" is deliberately the plain ink colour rather than green. Reachability
 * already owns the green/red dot on a node, and a second green marker beside
 * it just raises the question of which green means what -- so load only takes
 * on a colour once it's worth reacting to.
 */
export const LEVEL_TEXT: Record<MetricLevel, string> = {
  ok: "text-ink-muted",
  warn: "text-amber-400",
  critical: "text-red-400",
};

/**
 * Sparkline over the last hour of samples. Drawn as an inline SVG polyline
 * with a fixed 0-100 y-range, so two hosts' lines are directly comparable
 * and a flat 90% never looks like a calm graph.
 */
function Sparkline({
  samples,
  pick,
  level,
}: {
  samples: MetricSample[];
  pick: (s: MetricSample) => number;
  level: MetricLevel;
}) {
  if (samples.length < 2) {
    return (
      <div className="h-6 text-[10px] leading-6 text-ink-faint">
        collecting history…
      </div>
    );
  }

  const width = 100;
  const height = 24;
  const points = samples
    .map((s, i) => {
      const x = (i / (samples.length - 1)) * width;
      const y = height - (Math.min(100, Math.max(0, pick(s))) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const stroke =
    level === "critical"
      ? "rgb(239 68 68)"
      : level === "warn"
        ? "rgb(251 191 36)"
        : "rgb(52 211 153)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-6 w-full"
      role="img"
      aria-label="last hour"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function MetricRow({
  label,
  percent,
  detail,
  samples,
  pick,
}: {
  label: string;
  percent: number;
  detail: string;
  samples: MetricSample[];
  pick: (s: MetricSample) => number;
}) {
  const level = metricLevel(percent);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="section-header">{label}</span>
        <span className={`font-mono ${LEVEL_TEXT[level]}`}>
          {percent.toFixed(0)}%
          <span className="ml-2 text-ink-faint">{detail}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full transition-all ${LEVEL_BAR[level]}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <Sparkline samples={samples} pick={pick} level={level} />
    </div>
  );
}

export function HostMonitoring({
  metrics,
}: {
  metrics: HostMetricsResponse | undefined;
}) {
  if (!metrics) {
    return (
      <div className="rounded border border-border bg-surface px-2.5 py-2 text-[11px] text-ink-faint">
        <div className="section-header mb-1 flex items-center gap-1.5">
          <Activity size={11} /> Monitoring
        </div>
        Waiting for the first reading. Metrics are collected over SSH only
        while the host answers a ping.
      </div>
    );
  }

  if (metrics.error) {
    return (
      <div className="rounded border border-border bg-surface px-2.5 py-2 text-[11px]">
        <div className="section-header mb-1 flex items-center gap-1.5">
          <Activity size={11} /> Monitoring
        </div>
        <p className="break-words text-red-400">{metrics.error}</p>
      </div>
    );
  }

  const { history } = metrics;
  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-surface px-2.5 py-2">
      <div className="section-header flex items-center gap-1.5">
        <Activity size={11} /> Monitoring
      </div>

      <MetricRow
        label="CPU"
        percent={metrics.cpuPercent}
        detail={`${metrics.cpuCores} core${metrics.cpuCores === 1 ? "" : "s"}`}
        samples={history}
        pick={(s) => s.cpu}
      />
      <MetricRow
        label="Memory"
        percent={metrics.memPercent}
        detail={`${formatKb(metrics.memUsedKb)} / ${formatKb(metrics.memTotalKb)}`}
        samples={history}
        pick={(s) => s.mem}
      />
      <MetricRow
        label="Disk /"
        percent={metrics.diskPercent}
        detail={`${formatKb(metrics.diskUsedKb)} / ${formatKb(metrics.diskTotalKb)}`}
        samples={history}
        pick={(s) => s.disk}
      />

      <div className="flex justify-between text-[10px] text-ink-faint">
        <span className="font-mono">
          load {metrics.load1.toFixed(2)} {metrics.load5.toFixed(2)}{" "}
          {metrics.load15.toFixed(2)}
        </span>
        <span>up {formatUptime(metrics.uptimeSec)}</span>
      </div>
    </div>
  );
}
