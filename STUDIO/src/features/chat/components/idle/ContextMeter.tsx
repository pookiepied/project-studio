/**
 * ContextMeter — a muted "48k / 200k · 24%" chip showing how full the model's
 * context window is, from REAL usage (system prompt + skills + tools + every
 * file-read result), not a tokenizer estimate. Renders nothing until a real
 * number is available.
 */

function fmtK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}

export function ContextMeter({ used, limit }: { used?: number; limit?: number }) {
  if (!used || used <= 0 || !limit || limit <= 0) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <span className="text-sm text-gray-300 dark:text-gray-600 tabular-nums" title="Context window used (real usage)">
      {fmtK(used)} / {fmtK(limit)} · {pct}%
    </span>
  );
}
