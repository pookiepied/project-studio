import type { HealthStatus } from "@pookiepied/core/contracts";
import { cn } from "../../lib/cn";

/**
 * The chart forms this console needs.
 *
 * Every mark is a plain element whose height or width is a number. There is no
 * charting library: this is smaller than any dependency and it is why the marks
 * inherit the theme for free.
 *
 * ---- Colour ---------------------------------------------------------------
 *
 * Data marks are the one place in the console allowed a hue, and the palette is
 * the validated one in `styles.css` — see the note there for the numbers. Text
 * never wears a series colour: values, labels and legends stay in ink, and
 * identity comes from the coloured mark beside them. A light categorical hue is
 * illegible as text on a white surface, so this is a legibility rule before it
 * is a taste one.
 */

/**
 * A series slot for a named entity.
 *
 * Hashed from the name rather than taken from array position, because colour
 * follows the entity and not its rank: filter the window down to two services
 * and the two that remain must keep the colours they had, or every chart in the
 * console silently re-paints itself whenever the data moves.
 */
const SERIES = [
  "bg-viz-1",
  "bg-viz-2",
  "bg-viz-3",
  "bg-viz-4",
  "bg-viz-5",
  "bg-viz-6",
] as const;

function slotFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % SERIES.length;
}

/**
 * Assign a colour to every name in one set.
 *
 * The hash alone was not enough. Six slots and four services is a birthday
 * problem: `auth` and `console` hashed to neighbouring greens, and two greens
 * on one chart is the failure the palette ordering exists to prevent. So a
 * collision inside the rendered set probes forward to the next free slot, in a
 * fixed name order — deterministic for a given set, and still hash-anchored, so
 * a service dropping out of a window leaves the survivors' colours alone in
 * every case where its slot was not the one being contested.
 */
export function assignSeries(names: readonly string[]): Map<string, string> {
  /**
   * The pool is only as wide as it needs to be.
   *
   * The palette validates its full eight on the *adjacent* pairlist — slot 1
   * against 2, 2 against 3 — which is the right gate for a stacked bar. It does
   * not promise slot 3 against slot 6, and the first attempt here proved why:
   * `auth` and `console` hashed to aqua and green, a pair nothing had ever
   * checked, and they were indistinguishable on screen.
   *
   * Only the first three slots are validated all-pairs. So with three services
   * or fewer the pool is exactly those three, and every pair on screen is one
   * the validator has cleared. Past three it widens, and past three the skill's
   * own advice applies anyway: fold to "Other" or facet.
   */
  const pool = names.length <= 3 ? 3 : SERIES.length;
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const name of [...names].sort()) {
    let slot = slotFor(name) % pool;
    for (let i = 0; i < pool && taken.has(slot); i++) slot = (slot + 1) % pool;
    taken.add(slot);
    out.set(name, SERIES[slot]!);
  }
  return out;
}

/** The reserved status set. `ok` stays neutral — see the token note. */
export const STATUS_MARK: Record<HealthStatus, string> = {
  ok: "bg-muted-foreground",
  degraded: "bg-viz-warning",
  down: "bg-viz-critical",
};

export interface ColumnDatum {
  label: string;
  /** The series colour, resolved by `assignSeries` for the whole set. */
  fill: string;
  /** Requests that succeeded. */
  value: number;
  /** Requests that failed. Drawn as a segment on top of the same column. */
  errors?: number;
  display: string;
}

/**
 * Stacked columns, one per service.
 *
 * ---- Why the column is capped at 24px -------------------------------------
 *
 * It was 96px, and before that it filled its slot entirely. A bar wider than
 * roughly 24px stops being a bar: there is no longer a length being compared,
 * only an area being filled, and three of them across a panel read as three
 * rectangles someone coloured in. The cap is the single biggest difference
 * between this and the version that looked like a slab — the slot still
 * stretches to distribute the columns evenly, the *ink* does not.
 *
 * The failure segment sits on top of the success segment with a 2px gap in the
 * surface colour. The gap is what separates them; no stroke is drawn around
 * either, because an outline adds ink that is not data.
 */
export function Columns({
  data,
  height = 190,
  className,
}: {
  data: readonly ColumnDatum[];
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value + (d.errors ?? 0)));
  return (
    <div className={cn("flex items-end gap-6 sm:gap-8", className)} style={{ height }}>
      {data.map((d) => {
        const total = d.value + (d.errors ?? 0);
        const pct = (n: number) => (n / max) * 100;
        return (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2">
            {/* The value rides the cap. Both references label the column rather
                than running a y-axis, and it is the right trade: the shape
                answers "compared to what" and the cap answers "how many". */}
            <span className="text-caption tnum truncate text-center text-muted-foreground">
              {d.display}
            </span>
            <div
              className="mx-auto flex w-full max-w-6 flex-col justify-end gap-0.5"
              style={{ height: `${Math.max(3, pct(total))}%` }}
            >
              {d.errors && d.errors > 0 ? (
                <div
                  className="w-full flex-none rounded-t bg-viz-critical"
                  style={{ height: `${Math.max(12, (d.errors / total) * 100)}%` }}
                  title={`${d.errors} failed`}
                />
              ) : null}
              <div
                className={cn(
                  "w-full flex-1",
                  // Square at the baseline, rounded only at the free end — and
                  // only when nothing is stacked above it.
                  d.errors && d.errors > 0 ? "" : "rounded-t",
                  d.fill,
                )}
              />
            </div>
            <span className="text-caption truncate text-center text-muted-foreground">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One dot per event, in the order they happened.
 *
 * Density is the question. A count says nine failed; a strip says whether the
 * nine arrived together or were spread across the day, which is the difference
 * between an incident and a flaky dependency. No axis: the answer is a shape.
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
          className={cn("size-2.5 flex-none rounded-full", STATUS_MARK[d.status])}
        />
      ))}
    </div>
  );
}

/**
 * A share of a whole, as one segmented bar.
 *
 * Used where a pie would be reached for. A pie asks the eye to compare angles,
 * which it is bad at; a bar asks it to compare lengths on one axis, which it is
 * good at. A 2px surface gap separates the segments, and a segment below a
 * visible width still renders — a category that vanishes at 0.3% is the one you
 * most need to see is non-zero.
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
    <div className={cn("flex h-2.5 gap-0.5", className)}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            className={cn(
              "h-full rounded-full",
              s.status === "ok" ? "bg-viz-1" : STATUS_MARK[s.status],
            )}
            style={{ minWidth: 4, width: `${(s.value / total) * 100}%` }}
          />
        ))}
    </div>
  );
}
