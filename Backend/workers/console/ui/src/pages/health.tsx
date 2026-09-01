import { Radio, Zap } from "lucide-react";
import type { HealthCheck } from "@pookiepied/core/contracts";
import { api, type ServiceHealth } from "../lib/api";
import { ms, relative, serviceLabel } from "../lib/format";
import { cn } from "../lib/cn";
import { useLive } from "../lib/useLive";
import { Appear, Card, Empty, List, Section } from "../components/ui";
import { StatusDot, StatusLabel } from "../components/status";

/**
 * A check's detail bag, rendered as it comes.
 *
 * The worker decides what is worth saying about each dependency — row counts,
 * cleanup backlog, query time, how many ingest keys are configured — and this
 * renders whatever arrived. The alternative is a fixed set of fields here, which
 * would mean every new thing a probe learns to report needs a UI change before
 * anyone can see it.
 */
function Detail({ detail }: { detail: Record<string, string | number | boolean | null> }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    /**
     * Wrapped into columns rather than one tall two-column grid.
     *
     * A probe reports between two and eight fields, and stacked in a single
     * column they became a paragraph of trivia in which the one number that
     * mattered — a cleanup backlog of eleven thousand — sat at the same weight
     * as `users 4`. Side by side they read as a set of readings, which is what
     * they are, and the long ones still get a full column to themselves.
     */
    <dl className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-1">
      {entries.map(([key, value]) => {
        const text = value === null ? "—" : String(value);
        // A URI or a team domain is not a reading, and squeezing it into a
        // column beside `users 4` truncates the key to make room for a value
        // that still does not fit. Anything long takes the whole row.
        const wide = text.length > 24;
        return (
          <div
            key={key}
            className={cn(
              "flex items-baseline justify-between gap-3 border-b border-hairline/60 py-0.5",
              wide && "col-span-full",
            )}
          >
            <dt className="text-caption flex-none text-muted-foreground">
              {key.replace(/_/g, " ")}
            </dt>
            <dd className={cn("text-caption tnum min-w-0 truncate text-right", !wide && "flex-none")} title={text}>
              {text}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Check({ check }: { check: HealthCheck }) {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <StatusDot status={check.status} className="mt-[0.45rem]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ui">{check.label}</span>
          <span className="flex items-baseline gap-3">
            {/* A dot says the service is unhappy; this says which dependency is,
                without making the reader match colours across three cards. */}
            {check.status !== "ok" ? <StatusLabel status={check.status} /> : null}
            <span className="text-caption tnum flex-none text-muted-foreground">
              {ms(check.latencyMs)}
            </span>
          </span>
        </div>
        <span className="text-caption text-muted-foreground">{check.kind}</span>
        {check.error ? (
          <p className="text-caption mt-1 text-danger">{check.error}</p>
        ) : check.detail ? (
          <Detail detail={check.detail} />
        ) : null}
      </div>
    </div>
  );
}

function Service({ service }: { service: ServiceHealth }) {
  const Origin = service.origin === "live" ? Zap : Radio;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2.5">
        <div className="flex items-center gap-2">
          <StatusDot status={service.status} />
          <span className="text-ui">{serviceLabel(service.service)}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusLabel status={service.status} />
          <span
            className="flex items-center gap-1"
            title={
              service.origin === "live"
                ? "Probed just now over a service binding"
                : `Last heartbeat ${relative(service.observedAt)}`
            }
          >
            <Origin className="mark" strokeWidth={1.75} />
            <span className="text-caption text-muted-foreground">
              {service.origin === "live" ? "Live" : relative(service.observedAt)}
            </span>
          </span>
        </div>
      </div>
      {service.checks.length > 0 ? (
        <List>
          {service.checks.map((c) => (
            <Check key={c.id} check={c} />
          ))}
        </List>
      ) : (
        <Empty>No checks reported.</Empty>
      )}
    </Card>
  );
}

export function HealthPage() {
  const health = useLive(() => api.health(), 30_000, []);

  return (
    <Appear className="flex flex-col gap-6">
      <Section
        title="Services"
        action={
          health.refreshedAt ? (
            <span className="text-caption text-muted-foreground">
              Checked {relative(health.refreshedAt)}
            </span>
          ) : null
        }
      >
        {health.error ? (
          <Card>
            <Empty>Could not reach the health endpoint — {health.error}</Empty>
          </Card>
        ) : health.loading ? (
          <Card>
            <Empty>Checking…</Empty>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {(health.data?.services ?? []).map((s) => (
              <Service key={s.service} service={s} />
            ))}
          </div>
        )}
      </Section>

      <p className="text-caption text-muted-foreground">
        Auth is probed live on every load; everything else reports a heartbeat every five minutes.
        A service with no heartbeat for fifteen minutes is shown as down — absence is the signal.
      </p>
    </Appear>
  );
}
