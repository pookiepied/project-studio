import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { StatusDot } from "../status";
import type { HealthStatus } from "@pookiepied/core/contracts";

/**
 * A panel.
 *
 * ---- Why the padding is this large ----------------------------------------
 *
 * It was 12px, and that single number was most of what made the first attempt
 * at this layout read as boxes nested in boxes. A panel with tight padding has
 * no interior — its content sits against its edge, so the edge is the loudest
 * thing about it, and a grid of them becomes a grid of outlines. The references
 * run 24-32px, and the reason it works is that at that distance the border
 * stops being read at all: you see a field of content with quiet separations,
 * not a stack of containers.
 *
 * The same reasoning removes the ring. A rounded rect with a hairline ring,
 * sitting inside a rounded rect with a hairline ring, is two frames saying the
 * same thing — the shell already establishes the surface, so a panel only needs
 * to be a lighter tone on it. Elevation carries the rest.
 */
export function Panel({
  className,
  tone = "raised",
  children,
}: {
  className?: string;
  /**
   * `raised` is the default surface. `inset` is the recessed one — the panel
   * the references set apart to stop a grid of equals from reading as
   * wallpaper. Used sparingly, and never for two panels side by side.
   *
   * Recessed rather than inverted, which is what it was first. The reference
   * inverts a card to near-black because its page is light; doing the same on a
   * dark page means a near-white card, and at panel size that is not an accent,
   * it is a hole punched in the screen that pulls the eye whether or not
   * anything is wrong. A tone *below* the shell reads as set-into the surface
   * in both themes, and keeps its emphasis without the glare.
   */
  tone?: "raised" | "inset";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl",
        tone === "raised" ? "bg-surface" : "bg-canvas ring-1 ring-hairline",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The panel's own header.
 *
 * The title is set at UI size, not micro-uppercase-grey. A label that small and
 * that faint is legible but not *readable* — it becomes texture, and a panel
 * whose name is texture is a panel you identify by its position on the page.
 * The hierarchy is carried by the number underneath being four times its size,
 * which is a bigger gap than shrinking the label could ever buy.
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
        "flex min-h-(--control-md) items-start justify-between gap-3 px-6 pt-5",
        className,
      )}
    >
      <h2 className="text-ui font-medium">{title}</h2>
      {actions ? <div className="flex flex-none items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 flex-1 px-6 py-5", className)}>{children}</div>;
}

export interface LegendEntry {
  label: string;
  status: HealthStatus;
  value?: string;
}

/**
 * The footer: what the marks above mean, and what they add up to.
 *
 * Both references put a legend and a total on one line at the bottom of a
 * chart, and it is the right place for both — a legend above the chart is read
 * before there is anything to apply it to, and a total anywhere else competes
 * with the panel's own headline number.
 */
export function PanelFooter({
  legend,
  swatches,
  total,
  className,
}: {
  legend?: readonly LegendEntry[];
  /** Series keys: a mark in the series colour beside the entity's own name. */
  swatches?: readonly { label: string; className: string }[];
  total?: string;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        "mt-auto flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-6 pb-5 pt-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {(swatches ?? []).map((sw) => (
          <span key={sw.label} className="flex items-center gap-1.5">
            {/* The swatch carries the colour; the label stays in ink. Text never
                wears a series hue — a light categorical colour is illegible as
                text on a white surface. */}
            <span className={cn("size-2.5 flex-none rounded-full", sw.className)} />
            <span className="text-caption text-muted-foreground">{sw.label}</span>
          </span>
        ))}
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
