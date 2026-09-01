import type { HealthStatus } from "@pookiepied/core/contracts";
import { STATUS_MARK } from "./primitives/Chart";
import { cn } from "../lib/cn";

/**
 * The status indicator.
 *
 * Three states, drawn from the reserved status set in `Chart`. `ok` stays a
 * quiet neutral: on a console where almost everything is healthy, a field of
 * green is noise, and it spends the reader's attention on exactly the rows that
 * need none. Only trouble is coloured, and the two kinds of trouble differ by
 * hue rather than by shape.
 *
 * That last part is the change. `degraded` used to be a hollow ring, because a
 * monochrome palette had no second colour to spend on it — a workaround that
 * worked at 8px and nowhere else. With a status set available the ring is not
 * needed, and a disc reads at any size.
 *
 * The dot never travels alone: every place it appears, a word or a legend entry
 * sits beside it, so hue is never the only channel carrying the state.
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
            status === "down" ? "bg-viz-critical" : "bg-viz-warning",
          )}
        />
      ) : null}
      <span
        className={cn(
          "size-2 rounded-full",
          STATUS_MARK[status],
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
