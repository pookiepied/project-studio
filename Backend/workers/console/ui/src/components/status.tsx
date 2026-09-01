import type { HealthStatus } from "@pookiepied/core/contracts";
import { cn } from "../lib/cn";

/**
 * The status indicator, and the only element in the console permitted a hue.
 *
 * Three states have to be distinguishable at 5px without reading a label, and
 * the interface is otherwise monochrome — so the ladder is contrast first and
 * colour last: `ok` is quiet muted grey, `degraded` steps up to full
 * foreground, and only `down` reaches for `--danger`. That keeps a healthy
 * console entirely colourless, which means any colour on screen is information.
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
    <span className={cn("relative inline-grid size-1.5 flex-none place-items-center", className)}>
      {pulse && status !== "ok" ? (
        <span
          className={cn(
            "absolute size-1.5 animate-ping rounded-full opacity-60",
            status === "down" ? "bg-danger" : "bg-foreground",
          )}
        />
      ) : null}
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "ok" && "bg-muted-foreground",
          status === "degraded" && "bg-foreground",
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
