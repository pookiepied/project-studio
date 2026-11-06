import { formatTokens, type ContextBreakdown } from "@/domain/turn/context";
import { cn } from "@/lib/cn";

const CONTEXT_CELLS = 100;

/** Each cell represents one percent of the model's window. */
export function ContextTank({
  breakdown,
  running,
}: {
  readonly breakdown: ContextBreakdown;
  readonly running: boolean;
}) {
  const { measured, pending } = breakdown.report;
  const percent = Math.round(breakdown.used * 100);

  if (measured?.estimated === true) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="text-muted-foreground">Context</span>
          <span className="text-foreground">Awaiting next turn</span>
        </div>
        <p className="text-micro text-muted-foreground/80">
          Compacted. Usage will be measured on the next turn.
        </p>
      </div>
    );
  }

  const cellAt = (tokens: number) => Math.round(tokens / breakdown.window * CONTEXT_CELLS);
  const sent = measured === null ? 0 : measured.fresh + measured.cached;
  const bands = [
    { end: cellAt(sent), className: "bg-foreground/55" },
    { end: cellAt(sent + (measured?.reply ?? 0)), className: "bg-foreground/30" },
    { end: cellAt(breakdown.total), className: "bg-foreground/15" },
  ];
  const threshold = breakdown.compactsAt === null ? null : Math.min(
    CONTEXT_CELLS - 1,
    Math.floor(breakdown.compactsAt / breakdown.window * CONTEXT_CELLS),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-caption text-muted-foreground">Context</span>
        <span className="shrink-0 tabular-nums text-foreground">
          <span className="text-ui font-medium">
            {pending > 0 ? "~" : ""}
            {formatTokens(breakdown.total)}
          </span>
          <span className="text-caption text-muted-foreground">
            {" / "}
            {formatTokens(breakdown.window)} &middot; {percent}%
          </span>
        </span>
      </div>

      <div
        role="meter"
        aria-label="Context used"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "grid grid-cols-[repeat(25,minmax(0,1fr))] gap-0.5",
          running && "studio-breathe",
        )}
      >
        {Array.from({ length: CONTEXT_CELLS }, (_, index) => {
          const band = bands.find(({ end }) => index < end);
          return (
            <span
              key={index}
              aria-hidden
              data-filled={band !== undefined ? '' : undefined}
              className={cn(
                "aspect-square rounded-[2px] transition-[background-color] duration-base",
                band?.className ?? "bg-foreground/10",
                index === threshold && "outline outline-1 -outline-offset-1 outline-foreground/50",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ContextCategories() {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1 border-t pt-2 text-caption text-muted-foreground [&_dd]:text-right [&_dt]:whitespace-nowrap">
      <dt>System prompt</dt><dd>Unmeasured</dd>
      <dt>Tools</dt><dd>Unmeasured</dd>
      <dt>Files</dt><dd>Unmeasured</dd>
      <dt>Conversation</dt><dd>Unmeasured</dd>
      <dt>Memory</dt><dd>N/A</dd>
    </dl>
  );
}
