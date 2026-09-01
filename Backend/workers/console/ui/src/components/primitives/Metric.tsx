import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A change, next to the number it happened to.
 *
 * The references draw this as a coloured pill — green for up, red for down —
 * which works because "up" is unambiguously good in a sales dashboard. Here it
 * is not: requests rising is traffic, errors rising is an incident, and p95
 * rising is a regression. So the chip carries a direction and a *judgement*
 * that the caller supplies, and only a bad one is allowed the danger hue. A
 * neutral change stays monochrome, which keeps the rule that colour on this
 * screen means something.
 */
export function Delta({
  value,
  tone = "neutral",
}: {
  /** Already formatted, sign included: `+12%`, `-4ms`. */
  value: string;
  tone?: "neutral" | "bad";
}) {
  return (
    <span
      className={cn(
        "text-micro tnum inline-flex flex-none items-center rounded-full px-1.5 py-0.5",
        tone === "bad" ? "bg-danger/10 text-danger" : "bg-tint text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/**
 * The hero of a panel: one number, its name, and what qualifies it.
 *
 * Label above rather than below. Both references do this and the reason is
 * scanning order — you arrive at a tile already knowing you want a number, so
 * the label's job is to tell you *which* number this is before your eye lands
 * on it, not to caption it afterwards.
 */
export function Metric({
  label,
  value,
  hint,
  delta,
  emphasis = false,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: ReactNode;
  /** Reserved for a number that is itself the problem. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-micro uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={cn("text-metric tnum truncate", emphasis && "text-danger")}>{value}</span>
        {delta}
      </span>
      {hint ? <span className="text-caption truncate text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
