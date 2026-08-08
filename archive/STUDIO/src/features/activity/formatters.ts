import type { ChartMetric, UsageRow } from "./types";

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtCost(n: number | null | undefined, decimals = 4): string {
  if (n == null || n === 0) return n === 0 ? "$0.00" : "—";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(decimals)}`;
}

export function fmtLatency(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function fmtRelative(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtShortDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });
  } catch { return dateStr; }
}

export function fmtMetricValue(metric: ChartMetric, val: number | null): string {
  if (val == null) return "—";
  if (metric === "cost_usd") return fmtCost(val, 3) ?? "—";
  if (metric === "requests") return String(val);
  if (metric === "error_rate") return `${val.toFixed(1)}%`;
  return fmtTokens(val);
}

export function fillDailyGaps(data: UsageRow[], days: number): UsageRow[] {
  const map = new Map(data.map((d) => [d.label, d]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const label = d.toISOString().slice(0, 10);
    return map.get(label) ?? {
      label, requests: 0, input_tokens: 0, output_tokens: 0,
      cost_usd: null, success_count: 0, error_count: 0, error_rate: 0,
    };
  });
}
