import { api } from "../lib/api";
import { count, ms, parseTimestamp, relative, serviceLabel } from "../lib/format";
import { useLive } from "../lib/useLive";
import { Appear, Card, Empty, List, Row, Section } from "../components/ui";
import { Readout, StatusDot } from "../components/status";
import type { PageId } from "../components/chrome";

/**
 * The page you leave open.
 *
 * Four numbers, the services, and what recently went wrong. Everything here
 * answers "is anything asking for my attention"; anything that answers a
 * follow-up question lives on the page for that question.
 */
export function OverviewPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const health = useLive(() => api.health(), 30_000, []);
  const summary = useLive(() => api.summary(24), 30_000, []);
  const errors = useLive(() => api.activity({ hours: 24, errorsOnly: true }), 30_000, []);

  const sources = summary.data?.sources ?? [];
  const requests = sources.reduce((n, s) => n + Number(s.requests ?? 0), 0);
  const failures = sources.reduce((n, s) => n + Number(s.errors ?? 0), 0);
  const p95 = sources.reduce((worst, s) => Math.max(worst, Number(s.p95_ms ?? 0)), 0);
  const services = health.data?.services ?? [];
  const unhealthy = services.filter((s) => s.status !== "ok").length;

  return (
    <Appear className="flex flex-col gap-6">
      <Card className="grid grid-cols-2 divide-x divide-y divide-hairline sm:grid-cols-4 sm:divide-y-0">
        <Readout label="Requests" value={count(requests)} hint="last 24h" />
        <Readout
          label="Errors"
          value={count(failures)}
          hint={requests > 0 ? `${((failures / requests) * 100).toFixed(2)}% of traffic` : "—"}
          emphasis={failures > 0}
        />
        <Readout label="p95" value={ms(p95 || null)} hint="slowest service" />
        <Readout
          label="Services"
          value={`${services.length - unhealthy}/${services.length || 0}`}
          hint={unhealthy === 0 ? "all healthy" : `${unhealthy} needing attention`}
          emphasis={unhealthy > 0}
        />
      </Card>

      <Section
        title="Systems"
        action={
          <button
            onClick={() => onNavigate("health")}
            className="text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground"
          >
            details
          </button>
        }
      >
        <Card className="overflow-hidden">
          {services.length === 0 ? (
            <Empty>{health.loading ? "Checking…" : "No services reporting yet."}</Empty>
          ) : (
            <List>
              {services.map((s) => {
                const traffic = sources.find((x) => x.source === s.service);
                return (
                  <Row key={s.service} onClick={() => onNavigate("health")}>
                    <StatusDot status={s.status} />
                    <span className="text-ui flex-1 truncate">{serviceLabel(s.service)}</span>
                    {traffic ? (
                      <span className="text-caption tnum text-muted-foreground">
                        {count(Number(traffic.requests))} req · {ms(Number(traffic.p95_ms))}
                      </span>
                    ) : null}
                    <span className="text-caption w-16 flex-none text-right text-muted-foreground">
                      {s.origin === "live" ? "live" : relative(s.observedAt)}
                    </span>
                  </Row>
                );
              })}
            </List>
          )}
        </Card>
      </Section>

      <Section
        title="Recent failures"
        action={
          <button
            onClick={() => onNavigate("activity")}
            className="text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground"
          >
            all activity
          </button>
        }
      >
        <Card className="overflow-hidden">
          {errors.loading ? (
            <Empty>Loading…</Empty>
          ) : (errors.data?.events ?? []).length === 0 ? (
            <Empty>Nothing failed in the last 24 hours.</Empty>
          ) : (
            <List>
              {(errors.data?.events ?? []).slice(0, 8).map((e, i) => (
                <Row key={`${e.ts}-${i}`}>
                  <StatusDot status={e.status >= 500 || e.event === "exception" ? "down" : "degraded"} />
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
          )}
        </Card>
      </Section>
    </Appear>
  );
}
