import { Activity, AlertTriangle, ArrowUpRight, Gauge, Server } from "lucide-react";
import { api } from "../lib/api";
import { count, ms, parseTimestamp, relative, serviceLabel } from "../lib/format";
import { useLive } from "../lib/useLive";
import { Appear, Button, Empty, List, Row } from "../components/ui";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "../components/primitives/Panel";
import { Delta, Metric, Tile } from "../components/primitives/Metric";
import { Columns, DotMatrix, Meter, assignSeries } from "../components/primitives/Chart";
import { StatusDot } from "../components/status";
import type { PageId } from "../components/chrome";

/**
 * The page you leave open.
 *
 * ---- The shape of the page ------------------------------------------------
 *
 * Three bands, in the order the questions get asked. A row of headline figures
 * you scan without reading. Then the two panels that explain them — where the
 * traffic went, and how much of it failed. Then the two lists you descend into
 * once something above looked wrong.
 *
 * The bands are different heights on purpose. A grid of equal panels is a
 * grid with no argument in it: every cell claims the same importance, so the
 * reader has to supply the priority themselves every time they look. The
 * references both spend their top third on one or two large panels and demote
 * everything else, and that demotion is the design.
 *
 * Everything here is data the workers already report. No panel exists because
 * the layout had a gap in it, and no number on screen is invented.
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

  // One assignment for the whole set, so the chart and its legend agree.
  const fills = assignSeries(sources.map((s) => serviceLabel(s.source)));

  const failureRows = errors.data?.events ?? [];
  const events = recent.data?.events ?? [];

  const link = (page: PageId, label: string) => (
    <Button onClick={() => onNavigate(page)} className="text-caption text-muted-foreground">
      {label}
      <ArrowUpRight className="mark" strokeWidth={1.75} />
    </Button>
  );

  const mark = (Icon: typeof Activity) => <Icon className="mark" strokeWidth={1.75} />;

  return (
    <Appear className="flex flex-col gap-4">
      {/* ── Band one: the figures you scan ───────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel>
          <Tile
            label="Requests"
            value={count(requests)}
            hint="Last 24 hours"
            icon={mark(Activity)}
          />
        </Panel>
        <Panel>
          <Tile
            label="Errors"
            value={count(failures)}
            emphasis={failures > 0}
            icon={mark(AlertTriangle)}
            delta={
              requests > 0 ? (
                <Delta value={`${errorRate.toFixed(2)}%`} tone={failures > 0 ? "bad" : "neutral"} />
              ) : undefined
            }
            hint="Of all traffic"
          />
        </Panel>
        <Panel>
          <Tile label="p95" value={ms(p95 || null)} hint="Slowest service" icon={mark(Gauge)} />
        </Panel>
        <Panel>
          <Tile
            label="Services"
            value={`${services.length - unhealthy}/${services.length || 0}`}
            emphasis={unhealthy > 0}
            icon={mark(Server)}
            hint={unhealthy === 0 ? "All healthy" : `${unhealthy} needing attention`}
          />
        </Panel>
      </div>

      {/* ── Band two: where it went, and what failed ─────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Traffic by service" actions={link("activity", "Activity")} />
          <PanelBody className="flex flex-col gap-5">
            <Metric label="Requests, last 24 hours" value={count(requests)} />
            {sources.length === 0 ? (
              <Empty>{summary.loading ? "Loading…" : "Nothing has reported yet."}</Empty>
            ) : (
              <Columns
                className="max-w-sm"
                height={150}
                data={sources.map((s) => {
                  const total = Number(s.requests ?? 0);
                  const failed = Number(s.errors ?? 0);
                  const name = serviceLabel(s.source);
                  return {
                    label: name,
                    fill: fills.get(name) ?? "bg-viz-1",
                    // `requests` is the total, so the success segment is the
                    // remainder — stacking total + errors would double-count
                    // every failure and inflate the column.
                    value: Math.max(0, total - failed),
                    errors: failed,
                    display: count(total),
                  };
                })}
              />
            )}
          </PanelBody>
          <PanelFooter
            swatches={sources.map((s) => ({
              label: serviceLabel(s.source),
              className: fills.get(serviceLabel(s.source)) ?? "bg-viz-1",
            }))}
            legend={failures > 0 ? [{ label: "Failed", status: "down" }] : []}
            total={`Total: ${count(requests)} requests`}
          />
        </Panel>

        {/* The one inverted tile. It is the panel you want found first when
            something is wrong, and inversion is the cheapest way to say so
            without spending the colour budget. */}
        <Panel tone="inset">
          <PanelHeader title="Reliability" />
          <PanelBody className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-caption opacity-70">Failing requests</span>
              <span className="text-hero">{errorRate.toFixed(2)}%</span>
              <span className="text-caption opacity-70">
                {count(failures)} of {count(requests)} in 24 hours
              </span>
            </div>
            <Meter
              segments={[
                { label: "Succeeded", value: Math.max(0, requests - failures), status: "ok" },
                { label: "Failed", value: failures, status: "down" },
              ]}
            />
            <div className="flex flex-col gap-2">
              <span className="text-caption opacity-70">Last {events.length} events</span>
              {/* One dot per event: a count says nine failed, this says whether
                  the nine arrived together or were spread out. */}
              <DotMatrix
                data={events.slice(0, 48).map((e, i) => ({
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
        </Panel>
      </div>

      {/* ── Band three: what you descend into ────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Systems" actions={link("health", "Health")} />
          <div className="mt-4 min-w-0 flex-1">
            {services.length === 0 ? (
              <Empty>{health.loading ? "Checking…" : "No services reporting yet."}</Empty>
            ) : (
              <List>
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

        <Panel className="xl:col-span-3">
          <PanelHeader title="Recent failures" actions={link("activity", "All activity")} />
          <div className="mt-4 min-w-0 flex-1">
            {errors.loading ? (
              <Empty>Loading…</Empty>
            ) : failureRows.length === 0 ? (
              <Empty>Nothing failed in the last 24 hours.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <List className="min-w-[30rem]">
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
      </div>
    </Appear>
  );
}
