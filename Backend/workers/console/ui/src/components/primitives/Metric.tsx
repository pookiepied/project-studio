import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A change, next to the number it happened to.
 *
 * The references draw this as a coloured pill — green up, red down — which
 * works because "up" is unambiguously good in a sales dashboard. Here it is
 * not: requests rising is traffic, errors rising is an incident, p95 rising is
 * a regression. So the chip carries a figure and a *judgement* the caller
 * supplies, and only a bad one is allowed the hue.
 */
export function Delta({
  value,
  tone = "neutral",
}: {
  value: string;
  tone?: "neutral" | "bad";
}) {
  return (
    <span
      className={cn(
        "text-caption tnum inline-flex flex-none items-center rounded-full px-2 py-0.5",
        tone === "bad" ? "bg-danger/12 text-danger" : "bg-foreground/8 text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/**
 * A KPI tile: one number, large, with its name above it.
 *
 * ---- Why the number is this size ------------------------------------------
 *
 * The label goes above rather than below because you arrive at a tile already
 * knowing you want a number — the label's job is to say *which* number before
 * your eye lands on it, not to caption it afterwards. Both references do this.
 *
 * The size is the part that matters. A "big" number that is 2x its label is not
 * big, it is slightly bigger, and a row of them reads as a paragraph. At 4x the
 * eye stops reading and starts jumping, which is the entire behaviour a
 * dashboard is designed around: you scan the headline figures, and only then
 * descend into whichever one looked wrong.
 */
export function Tile({
  label,
  value,
  hint,
  delta,
  icon,
  emphasis = false,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: ReactNode;
  icon?: ReactNode;
  /** Reserved for a number that is itself the problem. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-caption text-muted-foreground">{label}</span>
        {icon ? <span className="flex-none text-muted-foreground">{icon}</span> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("text-hero truncate", emphasis && "text-danger")}>{value}</span>
        {delta}
      </div>
      {hint ? <span className="text-caption truncate text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * The same figure at panel scale rather than tile scale — for a number that
 * shares its panel with a chart, and must not out-shout it.
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
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("text-metric tnum truncate", emphasis && "text-danger")}>{value}</span>
        {delta}
      </span>
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
