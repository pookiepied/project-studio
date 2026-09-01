import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { StatusDot } from "../status";
import type { HealthStatus } from "@pookiepied/core/contracts";

/**
 * A panel: the unit the dashboard is built from.
 *
 * Every panel is the same three parts in the same order — a header carrying a
 * title and the controls that act on *this* panel, a body, and an optional
 * footer that says what the body was counting. The reference dashboards both do
 * this and it is the thing that makes a grid of unlike cards read as one
 * instrument rather than as a collage: the eye learns the shape once, then
 * every panel after that is read by its content alone.
 *
 * The controls belong in the panel, not in a toolbar above the page. A period
 * selector at the top of a dashboard silently claims to govern everything under
 * it, which is only true until one panel needs its own window — and then the
 * toolbar is lying about the panel beside it.
 */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl bg-surface ring-1 ring-hairline shadow-chip",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The title sits at caption weight, not display weight.
 *
 * A panel's title is a signpost — you read it once to learn what the panel is
 * and never again. The number underneath is what you actually come back for, so
 * the title must not compete with it. This is the inversion the reference
 * dashboards make and it is why their big numbers land.
 */
export function PanelHeader({
  title,
  actions,
  className,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-(--control-md) items-center justify-between gap-3 px-4 pt-3.5",
        className,
      )}
    >
      <h2 className="text-micro uppercase tracking-wide text-muted-foreground">{title}</h2>
      {actions ? <div className="flex flex-none items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 flex-1 px-4 py-3", className)}>{children}</div>;
}

export interface LegendEntry {
  label: string;
  status: HealthStatus;
  value?: string;
}

/**
 * The footer: what the marks above mean, and what they add up to.
 *
 * Both references put a legend and a total on the same line at the bottom of a
 * chart, and it is the right place for both — a legend above the chart is read
 * before there is anything to apply it to, and a total anywhere else competes
 * with the panel's own headline number.
 */
export function PanelFooter({
  legend,
  total,
  className,
}: {
  legend?: readonly LegendEntry[];
  total?: string;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-4 py-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {(legend ?? []).map((e) => (
          <span key={e.label} className="flex items-center gap-1.5">
            <StatusDot status={e.status} />
            <span className="text-caption text-muted-foreground">{e.label}</span>
            {e.value ? <span className="text-caption tnum">{e.value}</span> : null}
          </span>
        ))}
      </div>
      {total ? (
        <span className="text-caption tnum flex-none text-muted-foreground">{total}</span>
      ) : null}
    </footer>
  );
}
