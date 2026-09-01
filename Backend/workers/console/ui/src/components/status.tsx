import type { HealthStatus } from "@pookiepied/core/contracts";
import { cn } from "../lib/cn";

/**
 * The status indicator, and the only element in the console permitted a hue.
 *
 * Three states have to be distinguishable without reading a label, and the
 * palette is chroma 0 apart from `--danger` — so the ladder cannot be three
 * colours. It is **form first, then colour**: `ok` is a quiet filled muted dot,
 * `degraded` is a hollow foreground ring, and only `down` fills with
 * `--danger`. A ring and a disc differ in shape rather than in value, which
 * survives both themes and the greyscale the palette commits to; two greys one
 * step apart did not, and "which service is unhappy" is the question this
 * whole page exists to answer.
 *
 * 8px rather than 6px for the same reason: a ring needs an interior to read as
 * one. It is still small enough to sit inline in a table row.
 */
export function StatusDot({
  status,
  className,
  pulse = false,
}: {
  status: HealthStatus;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span className={cn("relative inline-grid size-2 flex-none place-items-center", className)}>
      {pulse && status !== "ok" ? (
        <span
          className={cn(
            "absolute size-2 animate-ping rounded-full opacity-60",
            status === "down" ? "bg-danger" : "bg-foreground",
          )}
        />
      ) : null}
      <span
        className={cn(
          "size-2 rounded-full",
          status === "ok" && "bg-muted-foreground",
          // Hollow: the ring is drawn by the inset shadow, so the dot keeps its
          // footprint and rows do not shift when a status changes.
          status === "degraded" && "bg-transparent ring-[1.5px] ring-inset ring-foreground",
          status === "down" && "bg-danger",
        )}
      />
    </span>
  );
}

const WORD: Record<HealthStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
};

export function StatusLabel({ status }: { status: HealthStatus }) {
  return (
    <span className={cn("text-caption", status === "down" ? "text-danger" : "text-foreground")}>
      {WORD[status]}
    </span>
  );
}

/**
 * A number and what it counts.
 *
 * No sparkline, no bar, no delta arrow. A count over a window is a fact; a
 * chart of six data points is a decoration that implies a trend the data
 * cannot support.
 */
export function Readout({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5">
      <span className="text-micro uppercase text-muted-foreground">{label}</span>
      <span className={cn("text-title tnum", emphasis && "text-danger")}>{value}</span>
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
