import type { HealthStatus } from "@pookiepied/core/contracts";
import { cn } from "../../lib/cn";

/**
 * The three chart forms this console needs, and no more.
 *
 * The references carry a dozen between them — beeswarms, gantts, donuts,
 * gauges. Most of those exist because a sales dashboard has a dozen unrelated
 * quantities to show. This one has three shapes of question: how much per
 * thing (bars), how bad across a run (a dot per event), and what share of a
 * whole (a meter). Adding a fourth form should mean a fourth question, not a
 * wish for variety.
 *
 * All three are plain elements. There is no charting library here: every mark
 * below is a div whose width or colour is a number, which is both smaller than
 * any dependency and the reason these inherit the theme for free.
 */

/**
 * Two scales, because ink does not scale with area.
 *
 * A dot is eight pixels and has to survive being small, so it is solid. A bar
 * is four hundred pixels of the same colour, and solid foreground at that size
 * stops being a mark and becomes a light source — the panel inverts, and a
 * healthy service ends up the loudest thing on the page. So area marks take a
 * translucent tint of the same ink, and the ladder is carried by alpha.
 *
 * `down` keeps full strength in both, because the one thing allowed a hue is
 * allowed it at any size.
 */
const DOT_TONE: Record<HealthStatus, string> = {
  ok: "bg-muted-foreground",
  degraded: "bg-foreground",
  down: "bg-danger",
};

const AREA_TONE: Record<HealthStatus, string> = {
  ok: "bg-foreground/25",
  degraded: "bg-foreground/60",
  down: "bg-danger",
};

export interface BarDatum {
  label: string;
  value: number;
  /** Printed at the end of the bar. Defaults to the raw value. */
  display?: string;
  status?: HealthStatus;
  hint?: string;
}

/**
 * Horizontal bars, because the labels are words.
 *
 * A vertical bar chart puts its labels under the axis where a word has to be
 * rotated, truncated, or allowed to collide with its neighbours. Service names
 * are words, and there are never more than a handful of them, so the bars lie
 * down and the labels read normally.
 *
 * The scale is the largest value in the set, not a round number above it. A
 * dashboard bar is read against its siblings — "auth takes most of the
 * traffic" — and a padded axis makes every bar shorter to no one's benefit.
 */
export function Bars({ data, className }: { data: readonly BarDatum[]; className?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="text-caption w-20 flex-none truncate text-muted-foreground">
            {d.label}
          </span>
          <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-sunken">
            <div
              className={cn("h-full rounded-md transition-[width] duration-slow", AREA_TONE[d.status ?? "ok"])}
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-caption tnum w-16 flex-none text-right">
            {d.display ?? String(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * One dot per event, in the order they happened.
 *
 * This is the reference's dot matrix put to the one job it is actually good
 * at: density. A count of errors tells you there were nine; a strip of dots
 * tells you whether the nine were spread across the day or arrived together,
 * which is the difference between a flaky dependency and an incident. No axis,
 * because the answer is a shape rather than a value.
 */
export function DotMatrix({
  data,
  className,
}: {
  data: readonly { key: string; status: HealthStatus; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {data.map((d) => (
        <span
          key={d.key}
          title={d.title}
          className={cn("size-2 flex-none rounded-full", DOT_TONE[d.status])}
        />
      ))}
    </div>
  );
}

/**
 * A share of a whole, as one segmented bar.
 *
 * Used where a pie would be reached for. A pie asks the eye to compare angles,
 * which it is bad at; a single bar asks it to compare lengths along one axis,
 * which it is good at. Segments below a visible width still render, because a
 * category that vanishes at 0.3% is the one you most need to see is non-zero.
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
    return <div className={cn("h-2 rounded-full bg-surface-sunken", className)} />;
  }
  return (
    <div className={cn("flex h-2 gap-0.5 overflow-hidden rounded-full", className)}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            className={cn("h-full rounded-full", AREA_TONE[s.status])}
            style={{ minWidth: 3, width: `${(s.value / total) * 100}%` }}
          />
        ))}
    </div>
  );
}
