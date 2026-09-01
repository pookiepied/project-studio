/**
 * Analytics Engine returns `2026-08-22 05:31:52` — UTC, but with a space
 * instead of a `T` and no zone suffix. `Date.parse` reads that shape as *local*
 * time, so every row silently shifted by the viewer's offset. Say UTC.
 */
export function parseTimestamp(ts: string): number {
  if (!ts) return NaN;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(ts)
    ? ts.replace(" ", "T")
    : `${ts.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

export function relative(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Counts stay legible past a thousand without becoming approximate below it. */
export function count(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function ms(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return "<1ms";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

/** Turns `pookiepied-auth` into `auth` — the prefix is noise on every row. */
export function serviceLabel(source: string): string {
  return source.replace(/^pookiepied-/, "");
}
