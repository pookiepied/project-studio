import { ArrowUpRight } from "lucide-react";
import { api } from "../lib/api";
import { count, ms, parseTimestamp, relative, serviceLabel } from "../lib/format";
import { useLive } from "../lib/useLive";
import { Appear, Button, Empty, List, Row } from "../components/ui";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "../components/primitives/Panel";
import { Delta, Metric } from "../components/primitives/Metric";
import { Bars, DotMatrix, Meter } from "../components/primitives/Chart";
import { StatusDot } from "../components/status";
import type { PageId } from "../components/chrome";

/**
 * The page you leave open.
 *
 * A grid rather than a stack, which is the reference dashboards' one structural
 * idea worth taking wholesale: panels of unequal importance, sized unequally,
 * read in one sweep instead of one scroll. The four numbers, the traffic, the
 * failures and the systems all answer "is anything asking for my attention" —
 * and on a stack you had to scroll past two of them to find out.
 *
 * Everything here is data the workers already report. No panel was added
 * because the layout had a gap in it.
 */
export function OverviewPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const health = useLive(() => api.health(), 30_000, []);
  const summary = useLive(() => api.summary(24), 30_000, []);
  const errors = useLive(() => api.activity({ hours: 24, errorsOnly: true }), 30_000, []);
  const recent = useLive(() => api.activity({ hours: 24 }), 30_000, []);

  const sources = summary.data?.sources ?? [];
  const requests = sources.reduce((n, s) => n + Number(s.requests ?? 0), 0);
  const failures = sources.reduce((n, s) => n + Number(s.errors ?? 0), 0);
  const p95 = sources.reduce((worst, s) => Math.max(worst, Number(s.p95_ms ?? 0)), 0);
  const services = health.data?.services ?? [];
  const unhealthy = services.filter((s) => s.status !== "ok").length;
  const errorRate = requests > 0 ? (failures / requests) * 100 : 0;

  const failureRows = errors.data?.events ?? [];
  const events = recent.data?.events ?? [];

  const link = (page: PageId, label: string) => (
    <Button onClick={() => onNavigate(page)} className="text-caption text-muted-foreground">
      {label}
      <ArrowUpRight className="mark" strokeWidth={1.75} />
    </Button>
  );

  return (
    <Appear
      /**
       * Twelve columns, because the panels want thirds and quarters and a
       * six-column grid cannot express both. Everything collapses to one column
       * on a phone in source order, which is already priority order — the four
       * numbers first, then what is wrong, then what is fine.
       */
      className="grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12"
    >
      {/* ── The four numbers ─────────────────────────────────────────────── */}
      <Panel className="md:col-span-6 xl:col-span-12">
        <div className="grid grid-cols-2 divide-hairline sm:grid-cols-4 sm:divide-x">
          <div className="border-b border-hairline p-4 sm:border-b-0">
            <Metric label="Requests" value={count(requests)} hint="Last 24 hours" />
          </div>
          <div className="border-b border-l border-hairline p-4 sm:border-b-0 sm:border-l-0">
            <Metric
              label="Errors"
              value={count(failures)}
              emphasis={failures > 0}
              delta={
                requests > 0 ? (
                  <Delta value={`${errorRate.toFixed(2)}%`} tone={failures > 0 ? "bad" : "neutral"} />
                ) : undefined
              }
              hint="Of all traffic"
            />
          </div>
          <div className="border-hairline p-4">
            <Metric label="p95" value={ms(p95 || null)} hint="Slowest service" />
          </div>
          <div className="border-l border-hairline p-4 sm:border-l-0">
            <Metric
              label="Services"
              value={`${services.length - unhealthy}/${services.length || 0}`}
              emphasis={unhealthy > 0}
              hint={unhealthy === 0 ? "All healthy" : `${unhealthy} needing attention`}
            />
          </div>
        </div>
      </Panel>

      {/* ── Traffic ──────────────────────────────────────────────────────── */}
      <Panel className="md:col-span-3 xl:col-span-7">
        <PanelHeader title="Traffic by service" actions={link("activity", "Activity")} />
        <PanelBody>
          {sources.length === 0 ? (
            <Empty>{summary.loading ? "Loading…" : "Nothing has reported yet."}</Empty>
          ) : (
            <Bars
              data={sources.map((s) => ({
                label: serviceLabel(s.source),
                value: Number(s.requests ?? 0),
                display: count(Number(s.requests ?? 0)),
                status: Number(s.errors ?? 0) > 0 ? ("degraded" as const) : ("ok" as const),
                hint: ms(Number(s.p95_ms ?? 0)),
              }))}
            />
          )}
        </PanelBody>
        <PanelFooter
          legend={[
            { label: "Clean", status: "ok" },
            { label: "Has errors", status: "degraded" },
          ]}
          total={`Total: ${count(requests)}`}
        />
      </Panel>

      {/* ── Error share ──────────────────────────────────────────────────── */}
      <Panel className="md:col-span-3 xl:col-span-5">
        <PanelHeader title="Error share" />
        <PanelBody className="flex flex-col gap-3">
          <Metric
            label="Failing requests"
            value={`${errorRate.toFixed(2)}%`}
            emphasis={errorRate > 1}
            hint={`${count(failures)} of ${count(requests)} in 24 hours`}
          />
          <Meter
            segments={[
              { label: "Succeeded", value: Math.max(0, requests - failures), status: "ok" },
              { label: "Failed", value: failures, status: "down" },
            ]}
          />
          <div>
            <span className="text-micro uppercase tracking-wide text-muted-foreground">
              Last {events.length} events
            </span>
            {/* One dot per event: a count says there were nine failures, this
                says whether the nine arrived together or were spread out. */}
            <DotMatrix
              className="mt-2"
              data={events.slice(0, 60).map((e, i) => ({
                key: `${e.ts}-${i}`,
                status:
                  e.event === "exception" || e.status >= 500
                    ? ("down" as const)
                    : e.status >= 400
                      ? ("degraded" as const)
                      : ("ok" as const),
                title: `${serviceLabel(e.source)} ${e.path || e.event} — ${e.status || e.event}`,
              }))}
            />
          </div>
        </PanelBody>
        <PanelFooter
          legend={[
            { label: "OK", status: "ok" },
            { label: "4xx", status: "degraded" },
            { label: "5xx", status: "down" },
          ]}
        />
      </Panel>

      {/* ── Systems ──────────────────────────────────────────────────────── */}
      <Panel className="md:col-span-3 xl:col-span-5">
        <PanelHeader title="Systems" actions={link("health", "Health")} />
        <div className="min-w-0 flex-1">
          {services.length === 0 ? (
            <Empty>{health.loading ? "Checking…" : "No services reporting yet."}</Empty>
          ) : (
            <List className="border-t border-hairline">
              {services.map((s) => {
                const traffic = sources.find((x) => x.source === s.service);
                return (
                  <Row key={s.service} onClick={() => onNavigate("health")}>
                    <StatusDot status={s.status} />
                    <span className="text-ui min-w-0 flex-1 truncate">
                      {serviceLabel(s.service)}
                    </span>
                    {traffic ? (
                      <span className="text-caption tnum flex-none text-muted-foreground">
                        {ms(Number(traffic.p95_ms))}
                      </span>
                    ) : null}
                    <span className="text-caption w-16 flex-none text-right text-muted-foreground">
                      {s.origin === "live" ? "Live" : relative(s.observedAt)}
                    </span>
                  </Row>
                );
              })}
            </List>
          )}
        </div>
      </Panel>

      {/* ── Recent failures ──────────────────────────────────────────────── */}
      <Panel className="md:col-span-3 xl:col-span-7">
        <PanelHeader title="Recent failures" actions={link("activity", "All activity")} />
        <div className="min-w-0 flex-1">
          {errors.loading ? (
            <Empty>Loading…</Empty>
          ) : failureRows.length === 0 ? (
            <Empty>Nothing failed in the last 24 hours.</Empty>
          ) : (
            <div className="overflow-x-auto border-t border-hairline">
              <List className="min-w-[28rem]">
                {failureRows.slice(0, 6).map((e, i) => (
                  <Row key={`${e.ts}-${i}`}>
                    <StatusDot
                      status={e.status >= 500 || e.event === "exception" ? "down" : "degraded"}
                    />
                    <span className="text-caption w-20 flex-none truncate">
                      {serviceLabel(e.source)}
                    </span>
                    <span className="text-mono min-w-0 flex-1 truncate text-muted-foreground">
                      {e.path || e.event}
                    </span>
                    <span className="text-caption tnum flex-none">
                      {e.status > 0 ? e.status : e.event}
                    </span>
                    <span className="text-caption w-16 flex-none text-right text-muted-foreground">
                      {relative(parseTimestamp(e.ts))}
                    </span>
                  </Row>
                ))}
              </List>
            </div>
          )}
        </div>
      </Panel>
    </Appear>
  );
}
