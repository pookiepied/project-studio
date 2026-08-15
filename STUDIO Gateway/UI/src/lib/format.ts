export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { notation: value && value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value ?? 0);
}

export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: (value ?? 0) < 0.01 ? 4 : 2 }).format(value ?? 0);
}

export function formatDuration(value: number | null | undefined): string {
  const ms = value ?? 0;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
}

export function formatDate(value: number | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value);
}

export function formatDay(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", value.includes("T")
    ? { month: "short", day: "numeric", hour: "numeric" }
    : { month: "short", day: "numeric" }).format(date);
}

export function humanFinishReason(value: string | null | undefined): string {
  if (!value) return "In progress";
  const labels: Record<string, string> = { stop: "Completed", length: "Max tokens", tool_calls: "Tool call", content_filter: "Content filtered", error: "Provider error" };
  return labels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function humanCategory(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortId(value: string | null | undefined, size = 8): string {
  if (!value) return "-";
  return value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-size)}` : value;
}
