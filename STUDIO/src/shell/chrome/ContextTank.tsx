import {
  formatTokens,
  measuredTotal,
  type ContextBreakdown,
} from "@/domain/turn/context";
import { cn } from "@/lib/cn";

/**
 * How full the window is, drawn against the model it belongs to.
 *
 * ---- Why this is not a ring in the strip any more --------------------------
 *
 * It was, and the ring had two jobs it could not both do: be a quiet mark you
 * ignore, and be the thing you read when the window is nearly gone. Sitting
 * beside the model pill it was also a second small circle next to the
 * provider's mark, which is one circle too many for a corner that is meant to
 * be a label.
 *
 * The fill belongs where the model is, because that is what it is measured
 * against - a number with no model beside it is a fraction with no
 * denominator. So the whole account lives inside the model's own menu, and the
 * only thing left on the strip is a percentage in the pill's words, and only
 * once it is news.
 *
 * ---- What this may say -----------------------------------------------------
 *
 * Only what something measured. A table itemising the system prompt, the tool
 * definitions, the MCP servers, the skills and the memory files would look
 * more complete and would be mostly invention: no provider reports those, and
 * the harness does not count the sections of the prompt it assembles. What is
 * real is what was sent, how much of it was already cached, what came back,
 * and what the transcript has gained since - and the last of those is an
 * estimate, so it says so on its own row rather than in a footnote. The
 * category list names the missing measurements separately from these totals.
 *
 * ---- The line, and the figure after a compaction --------------------------
 *
 * The harness compacts the conversation at a point short of the window - a
 * reserve held back so the summariser's own request fits - and that point is
 * marked on the grid, with its number in the details. The
 * line is where the fill will stop growing and drop, which is worth knowing
 * before it happens rather than after.
 *
 * After a compaction nothing has measured the shortened conversation yet, so
 * the harness writes a provisional figure - the summary, the kept tail and a
 * fixed allowance - and marks it as such. Until a turn measures the shortened
 * context, the menu says it is awaiting that measurement rather than drawing
 * a provisional count as if it described the actual window.
 */

export type ContextBandId = "sent" | "reply" | "since";

interface Band {
  readonly id: ContextBandId;
  readonly label: string;
  readonly note: string;
  readonly value: number;
  readonly className: string;
  readonly estimated?: boolean;
}

const CONTEXT_CELLS = 100;

/** Every band the bar draws, in the order it draws them. */
function bandsOf(breakdown: ContextBreakdown): readonly Band[] {
  const measured = breakdown.report.measured;
  const bands: Band[] = [];
  if (measured !== null && !measured.estimated) {
    bands.push(
      {
        id: "sent",
        label: "Sent to the model",
        note: "The conversation and everything the turn carried with it.",
        value: measured.fresh + measured.cached,
        className: "bg-foreground/55",
      },
      {
        id: "reply",
        label: "Reply",
        note: "What the model produced, reasoning included.",
        value: measured.reply,
        className: "bg-foreground/30",
      },
    );
  }
  bands.push(
    {
      id: "since",
      label: measured === null ? "This conversation" : "Since that turn",
      note:
        measured === null
          ? "Estimated from the transcript. No turn has reported yet."
          : "Estimated: the message just sent, and the reply still arriving.",
      value: breakdown.report.pending,
      className: "bg-foreground/15",
      estimated: true,
    },
  );
  return bands.filter((band) => band.value > 0);
}

/**
 * Every cell is one percent of the window, read left to right by row.
 */
export function ContextTank({
  breakdown,
  running,
  highlight,
}: {
  readonly breakdown: ContextBreakdown;
  /** A turn is in flight: the bar breathes while the figure is still moving. */
  readonly running: boolean;
  readonly highlight?: ContextBandId | null;
}) {
  const bands = bandsOf(breakdown);
  const percent = Math.round(breakdown.used * 100);
  const estimated = breakdown.report.measured?.estimated === true;

  if (estimated) {
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

  let tokens = 0;
  const ends = bands.map((band) => {
    tokens += band.value;
    return { ...band, end: Math.round(tokens / breakdown.window * CONTEXT_CELLS) };
  });
  const threshold = breakdown.compactsAt === null ? null : Math.min(
    CONTEXT_CELLS - 1,
    Math.floor(breakdown.compactsAt / breakdown.window * CONTEXT_CELLS),
  );

  const highlighted = bands.find(({ id }) => id === highlight);
  const visibleTotal = highlighted?.value ?? breakdown.total;
  const visiblePercent = highlighted === undefined ? percent : Math.round(visibleTotal / breakdown.window * 100);
  const visibleEstimate = highlighted === undefined ? breakdown.report.pending > 0 : highlighted.estimated === true;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-caption text-muted-foreground">{highlighted?.label ?? "Context"}</span>
        <span className="shrink-0 tabular-nums text-foreground">
          <span className="text-ui font-medium">
            {visibleEstimate ? "~" : ""}
            {formatTokens(visibleTotal)}
          </span>
          <span className="text-caption text-muted-foreground">
            {" / "}
            {formatTokens(breakdown.window)} &middot; {visiblePercent}%
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
          const band = ends.find(({ end }) => index < end);
          return (
            <span
              key={index}
              aria-hidden
              data-filled={band !== undefined ? '' : undefined}
              className={cn(
                "aspect-square rounded-[2px] transition-[opacity,background-color] duration-base",
                band?.className ?? "bg-foreground/10",
                highlighted !== undefined && band?.id !== highlighted.id && "opacity-35",
                index === threshold && "outline outline-1 -outline-offset-1 outline-foreground/50",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The itemised account behind the bar, for when the bar is not enough. */
export function ContextDetails({
  breakdown,
  onHighlight,
}: {
  readonly breakdown: ContextBreakdown;
  readonly onHighlight?: (band: ContextBandId | null) => void;
}) {
  const bands = bandsOf(breakdown);
  const measured = breakdown.report.measured;

  if (measured?.estimated === true) {
    return (
      <p className="pt-1 text-micro text-muted-foreground/80">
        The shortened context has not been measured yet. Send a message to update its usage.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <ul className="flex flex-col gap-2">
        {bands.map((band) => (
          <li
            key={band.id}
            tabIndex={onHighlight === undefined ? undefined : 0}
            onPointerEnter={() => onHighlight?.(band.id)}
            onPointerLeave={() => onHighlight?.(null)}
            onFocus={() => onHighlight?.(band.id)}
            onBlur={() => onHighlight?.(null)}
            className="flex flex-col gap-0.5 rounded-sm"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-caption text-foreground">
                <span
                  className={cn("size-2 shrink-0 rounded-full", band.className)}
                  aria-hidden
                />
                {band.label}
              </span>
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {band.estimated === true ? "~" : ""}
                {formatTokens(band.value)}
              </span>
            </div>
            <span className="pl-3.5 text-micro text-muted-foreground/80">
              {band.note}
            </span>
          </li>
        ))}

        <li className="flex items-baseline justify-between gap-2 border-t pt-2">
          <span className="text-caption text-muted-foreground">Free</span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {formatTokens(breakdown.free)}
          </span>
        </li>

        {breakdown.compactsAt === null ? null : (
          <li className="flex items-baseline justify-between gap-2">
            <span className="text-caption text-muted-foreground">
              Compacts at
            </span>
            <span className="text-caption tabular-nums text-muted-foreground">
              {formatTokens(breakdown.compactsAt)} &middot;{" "}
              {Math.round((breakdown.compactsAt / breakdown.window) * 100)}%
            </span>
          </li>
        )}
      </ul>

      {measured !== null && measured.cached > 0 ? (
        <p className="text-micro text-muted-foreground/80">
          {formatTokens(measured.cached)} of the{" "}
          {formatTokens(measuredTotal(measured) - measured.reply)} sent came
          from the cache. It occupies the window the same way; it is only
          cheaper.
        </p>
      ) : null}

      {breakdown.windowDeclared ? null : (
        <p className="text-micro text-muted-foreground/80">
          This model declares no window, so {formatTokens(breakdown.window)}{" "}
          stands in for one, and the conversation is compacted only once the
          provider refuses a request.
        </p>
      )}
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
