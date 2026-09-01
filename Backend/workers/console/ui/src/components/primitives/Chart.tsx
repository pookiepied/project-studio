import type { HealthStatus } from "@pookiepied/core/contracts";
import { cn } from "../../lib/cn";

/**
 * The chart forms this console needs.
 *
 * All of them are plain elements. There is no charting library here: every mark
 * below is a div whose height or width is a number, which is both smaller than
 * any dependency and the reason they inherit the theme for free.
 *
 * ---- Two ink scales -------------------------------------------------------
 *
 * Solid foreground is right for an 8px dot and wrong for a 200px column, where
 * it stops being a mark and becomes a light source — the panel inverts and a
 * healthy service ends up the loudest thing on the page. Area marks take a
 * translucent tint and carry their ladder in alpha; dots stay solid. `down`
 * keeps full strength in both, because the one thing allowed a hue is allowed
 * it at any size.
 */
const DOT_TONE: Record<HealthStatus, string> = {
  ok: "bg-muted-foreground",
  degraded: "bg-foreground",
  down: "bg-danger",
};

const AREA_TONE: Record<HealthStatus, string> = {
  ok: "bg-foreground/20",
  degraded: "bg-foreground/45",
  down: "bg-danger/80",
};

export interface ColumnDatum {
  label: string;
  value: number;
  /** Printed in the chip above the column. */
  display: string;
  status?: HealthStatus;
}

/**
 * Columns, with the value floating above each one.
 *
 * ---- Why the chart is this tall -------------------------------------------
 *
 * The first version of this was a 20px bar, and a 20px bar is not a chart — it
 * is a progress indicator that happens to have siblings. A column chart earns
 * its space by making the *differences* visible, and a difference needs
 * vertical room to exist in: at 20px, twice-as-much and one-third-as-much are
 * ten pixels apart and the reader is back to reading the numbers, at which
 * point the chart was decoration.
 *
 * The value sits in a chip above its column rather than on an axis. Both
 * references do this, and it removes the whole left-hand axis — you read the
 * shape for comparison and the chip for the figure, which is the two questions
 * a bar chart is actually asked.
 */
export function Columns({
  data,
  height = 200,
  className,
}: {
  data: readonly ColumnDatum[];
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={cn("flex items-end gap-2 sm:gap-4", className)} style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2">
          <span className="text-caption tnum truncate text-center text-muted-foreground">
            {d.display}
          </span>
          {/* The slot stretches; the column does not. Three services across a
              900px panel would otherwise be 300px-wide slabs, which stops
              reading as a bar chart and starts reading as three filled
              rectangles. The cap keeps a column a column at any panel width,
              and the slot still distributes them evenly. */}
          <div
            className={cn("mx-auto w-full max-w-24 rounded-t-lg rounded-b-sm", AREA_TONE[d.status ?? "ok"])}
            // A floor, so a service with almost no traffic is still a visible
            // column rather than a label with nothing under it.
            style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }}
          />
          <span className="text-caption truncate text-center text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One dot per event, in the order they happened.
 *
 * Density is the question this answers. A count tells you there were nine
 * failures; a strip of dots tells you whether the nine arrived together or were
 * spread across the day, which is the difference between an incident and a
 * flaky dependency. No axis, because the answer is a shape rather than a value.
 */
export function DotMatrix({
  data,
  className,
}: {
  data: readonly { key: string; status: HealthStatus; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {data.map((d) => (
        <span
          key={d.key}
          title={d.title}
          className={cn("size-2.5 flex-none rounded-full", DOT_TONE[d.status])}
        />
      ))}
    </div>
  );
}

/**
 * A share of a whole, as one segmented bar.
 *
 * Used where a pie would be reached for. A pie asks the eye to compare angles,
 * which it is bad at; a bar asks it to compare lengths along one axis, which it
 * is good at. Segments below a visible width still render, because a category
 * that vanishes at 0.3% is the one you most need to see is non-zero.
 */
export function Meter({
  segments,
  className,
}: {
  segments: readonly { label: string; value: number; status: HealthStatus }[];
  className?: string;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (total <= 0) {
    return <div className={cn("h-2.5 rounded-full bg-foreground/10", className)} />;
  }
  return (
    <div className={cn("flex h-2.5 gap-1 overflow-hidden rounded-full", className)}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            className={cn("h-full rounded-full", AREA_TONE[s.status])}
            style={{ minWidth: 4, width: `${(s.value / total) * 100}%` }}
          />
        ))}
    </div>
  );
}

/**
 * A single quantity against its own ceiling — a latency against a budget, a
 * backlog against the point it becomes a problem.
 *
 * Drawn as a track rather than a gauge. A gauge spends a quarter of a circle
 * on furniture and asks the reader to interpret an angle; a track is the same
 * information along the axis they are already reading.
 */
export function Track({
  value,
  max,
  status = "ok",
  className,
}: {
  value: number;
  max: number;
  status?: HealthStatus;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100));
  return (
    <div className={cn("h-2.5 overflow-hidden rounded-full bg-foreground/10", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-slow", AREA_TONE[status])}
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );
}
