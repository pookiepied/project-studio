import { Radio, Zap } from "lucide-react";
import type { HealthCheck } from "@pookiepied/core/contracts";
import { api, type ServiceHealth } from "../lib/api";
import { ms, relative, serviceLabel } from "../lib/format";
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
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-caption text-muted-foreground">{key.replace(/_/g, " ")}</dt>
          <dd className="text-caption tnum">{value === null ? "—" : String(value)}</dd>
        </div>
      ))}
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
          <span className="text-caption tnum flex-none text-muted-foreground">
            {ms(check.latencyMs)}
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
              {service.origin === "live" ? "live" : relative(service.observedAt)}
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
              checked {relative(health.refreshedAt)}
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
