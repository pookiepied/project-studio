import { useEffect, useState } from "react";
import { gatewayApi } from "../lib/api";
import { formatDate, formatDuration } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorState, Eyebrow, SectionHeading, StatusDot, Surface } from "../components/ui";

interface Check { label: string; detail: string; status: "healthy" | "warning" | "error"; latency?: string; }

export function HealthPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  async function runChecks() {
    setLoading(true); setError("");
    const next: Check[] = [];
    const started = performance.now();
    try { const result = await gatewayApi.health(); next.push({ label: "Gateway", detail: `${result.environment ?? "Unknown environment"} · ${result.status}`, status: result.status === "ok" ? "healthy" : "error", latency: formatDuration(performance.now() - started) }); } catch (reason) { next.push({ label: "Gateway", detail: reason instanceof Error ? reason.message : "Unreachable", status: "error" }); }
    const dbStarted = performance.now();
    try { const result = await gatewayApi.ready(); next.push({ label: "Database", detail: result.db === "ok" ? "D1 connection ready" : result.status, status: result.db === "ok" ? "healthy" : "error", latency: formatDuration(performance.now() - dbStarted) }); } catch (reason) { next.push({ label: "Database", detail: reason instanceof Error ? reason.message : "Readiness check failed", status: "error" }); }
    setChecks(next); setCheckedAt(Date.now()); setLoading(false); if (next.some((check) => check.status === "error")) setError("One or more system checks need attention.");
  }
  useEffect(() => { void runChecks(); }, []);

  return <div className="page-frame"><SectionHeading eyebrow="OPERATE / HEALTH" title="Gateway health" detail="A quick operational read across the service and its persistence layer." action={<button type="button" className="secondary-button" onClick={() => void runChecks()} disabled={loading}><Icon name="arrowClockwise" size={15} className={loading ? "spin" : ""} /> Run checks</button>} />{error && <ErrorState message={error} />}{loading && !checks.length ? <Surface><div className="health-loading"><span /><span /><span /></div></Surface> : <><div className="health-summary"><Surface className="health-summary-card"><span className="health-summary-icon"><Icon name={checks.every((check) => check.status === "healthy") ? "check" : "warning"} size={22} /></span><div><Eyebrow>SYSTEM STATUS</Eyebrow><h2>{checks.every((check) => check.status === "healthy") ? "All systems operational" : "Attention required"}</h2><p>{checkedAt ? `Last checked ${formatDate(checkedAt)}` : "Waiting for first check"}</p></div></Surface></div><div className="health-grid">{checks.map((check) => <Surface className="health-card" key={check.label}><div className="health-card-top"><StatusDot status={check.status} /><strong>{check.label}</strong><span className="health-status-label">{check.status === "healthy" ? "Healthy" : "Unavailable"}</span></div><p>{check.detail}</p>{check.latency && <span className="health-latency"><Icon name="clock" size={13} /> {check.latency} response</span>}</Surface>)}</div><Surface className="endpoint-surface"><div className="surface-heading"><div><Eyebrow>PUBLIC SURFACES</Eyebrow><h2>Gateway endpoints</h2></div><Icon name="arrowUpRight" size={17} className="muted-icon" /></div><div className="endpoint-list"><Endpoint method="GET" path="/health" detail="Liveness" /><Endpoint method="GET" path="/ready" detail="Database readiness" /><Endpoint method="GET" path="/v1/models" detail="Production model catalog" /><Endpoint method="POST" path="/v1/chat/completions" detail="OpenAI-compatible generation" /></div></Surface></>}</div>;
}

function Endpoint({ method, path, detail }: { method: string; path: string; detail: string }) { return <div className="endpoint-row"><code className={`method method-${method.toLowerCase()}`}>{method}</code><code>{path}</code><span>{detail}</span><StatusDot status="healthy" /></div>; }
