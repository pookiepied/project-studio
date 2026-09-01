import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, type ActivityEvent } from "../lib/api";
import { clock, ms, parseTimestamp, serviceLabel } from "../lib/format";
import { useLive } from "../lib/useLive";
import { cn } from "../lib/cn";
import { Appear, Card, Chip, Empty, List, Section } from "../components/ui";
import { StatusDot } from "../components/status";

const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
];

function statusOf(e: ActivityEvent): "ok" | "degraded" | "down" {
  if (e.event === "exception" || e.status >= 500) return "down";
  if (e.status >= 400) return "degraded";
  return "ok";
}

/**
 * One event.
 *
 * Expanding shows the raw field bag rather than a curated subset, for the same
 * reason the health page renders whatever a probe reports: the worker decides
 * what is worth recording, and a fixed row shape here would quietly discard it.
 */
function Event({ event }: { event: ActivityEvent }) {
  const [open, setOpen] = useState(false);
  const fields = (() => {
    try {
      const parsed = JSON.parse(event.fields || "{}") as Record<string, unknown>;
      return Object.keys(parsed).length > 0 ? parsed : null;
    } catch {
      return null;
    }
  })();

  const at = parseTimestamp(event.ts);

  return (
    <div>
      <button
        onClick={() => fields && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-1.5 text-left",
          fields && "transition-colors duration-fast hover:bg-tint",
        )}
      >
        <StatusDot status={statusOf(event)} />
        <span className="text-caption tnum w-16 flex-none text-muted-foreground">
          {Number.isNaN(at) ? "—" : clock(at)}
        </span>
        <span className="text-caption w-20 flex-none truncate">{serviceLabel(event.source)}</span>
        <span className="text-caption flex-none text-muted-foreground">{event.event}</span>
        <span className="text-mono min-w-0 flex-1 truncate text-muted-foreground">
          {event.path || "—"}
        </span>
        <span className="text-caption tnum flex-none tabular-nums">
          {event.status > 0 ? event.status : ""}
        </span>
        <span className="text-caption tnum w-14 flex-none text-right text-muted-foreground">
          {event.duration_ms > 0 ? ms(event.duration_ms) : ""}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && fields ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <pre className="text-mono mx-3 mb-2 overflow-x-auto rounded-md bg-surface-sunken px-2.5 py-2 text-muted-foreground">
              {JSON.stringify(fields, null, 2)}
            </pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function ActivityPage() {
  const [hours, setHours] = useState(24);
  const [source, setSource] = useState<string | null>(null);
  const [event, setEvent] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);

  const facets = useLive(() => api.facets(hours), null, [hours]);
  const feed = useLive(
    () =>
      api.activity({
        hours,
        errorsOnly,
        ...(source ? { source } : {}),
        ...(event ? { event } : {}),
      }),
    10_000,
    [hours, source, event, errorsOnly],
  );

  const events = feed.data?.events ?? [];

  return (
    <Appear className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* Window and severity: the two filters that always apply. */}
        <div className="flex flex-wrap items-center gap-1">
          {WINDOWS.map((w) => (
            <Chip key={w.hours} active={hours === w.hours} onClick={() => setHours(w.hours)}>
              {w.label}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-hairline" />
          <Chip active={errorsOnly} onClick={() => setErrorsOnly((v) => !v)}>
            errors only
          </Chip>
        </div>

        {/* Source and event names come from what is actually in the data, so a
            new worker appears here the moment it reports for the first time. */}
        <div className="flex flex-wrap items-center gap-1">
          <Chip active={source === null} onClick={() => setSource(null)}>
            all systems
          </Chip>
          {(facets.data?.sources ?? []).map((s) => (
            <Chip
              key={s.source}
              active={source === s.source}
              onClick={() => setSource(source === s.source ? null : s.source)}
            >
              {serviceLabel(s.source)}
              <span className="tnum text-muted-foreground">{s.n}</span>
            </Chip>
          ))}
        </div>

        {(facets.data?.events ?? []).length > 1 ? (
          <div className="flex flex-wrap items-center gap-1">
            <Chip active={event === null} onClick={() => setEvent(null)}>
              all events
            </Chip>
            {(facets.data?.events ?? []).map((e) => (
              <Chip
                key={e.event}
                active={event === e.event}
                onClick={() => setEvent(event === e.event ? null : e.event)}
              >
                {e.event}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <Section
        title={`${events.length} event${events.length === 1 ? "" : "s"}`}
        action={
          <span className="flex items-center gap-1.5">
            <StatusDot status="ok" />
            <span className="text-caption text-muted-foreground">live</span>
          </span>
        }
      >
        <Card className="overflow-hidden">
          {feed.error ? (
            <Empty>Could not load activity — {feed.error}</Empty>
          ) : feed.loading ? (
            <Empty>Loading…</Empty>
          ) : events.length === 0 ? (
            <Empty>Nothing in this window.</Empty>
          ) : (
            /**
             * The row has seven columns at fixed widths, which below roughly
             * 44rem stopped fitting — and a card that clips simply loses the
             * path and the duration off the right edge with nothing to say it
             * has. Scrolling the table inside its own card keeps every column
             * reachable on a narrow window and changes nothing on a wide one.
             */
            <div className="overflow-x-auto">
              <List className="min-w-[44rem]">
                {events.map((e, i) => (
                  <Event key={`${e.ts}-${i}`} event={e} />
                ))}
              </List>
            </div>
          )}
        </Card>
      </Section>
    </Appear>
  );
}
