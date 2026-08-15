import { useEffect, useState } from "react";
import { gatewayApi, type GatewayRequest, type RequestDetail } from "../lib/api";
import { formatCurrency, formatDate, formatDuration, formatNumber, humanCategory, humanFinishReason, shortId } from "../lib/format";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, Eyebrow, LoadingLine, ProviderMark, SectionHeading, Surface } from "../components/ui";
import { RequestTable } from "./DashboardPage";

export function RequestsPage() {
  const [rows, setRows] = useState<GatewayRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [application, setApplication] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<GatewayRequest | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "100" });
    if (model.trim()) params.set("model", model.trim());
    if (provider.trim()) params.set("provider", provider.trim());
    if (application.trim()) params.set("application", application.trim());
    try {
      const result = await gatewayApi.requests(params.toString());
      setRows(result.data);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function select(row: GatewayRequest) {
    setSelected(row);
    setDetail(null);
    try { setDetail((await gatewayApi.request(row.request_id)).data); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load request detail"); }
  }

  return <div className="page-frame">
    <SectionHeading eyebrow="OPERATIONS / REQUESTS" title="Request explorer" detail={`${formatNumber(total)} normalized request records in the gateway telemetry store.`} action={<button type="button" className="secondary-button" onClick={() => void load()}><Icon name="arrowClockwise" size={15} /> Refresh</button>} />
    <Surface className="filter-surface"><div className="filter-heading"><div><Eyebrow>FILTER STREAM</Eyebrow><span>Start broad, then narrow to a model, provider, or application.</span></div><button type="button" className="text-button" onClick={() => { setModel(""); setProvider(""); setApplication(""); void load(); }}>Clear filters</button></div><div className="filter-row"><label className="search-input"><Icon name="magnifying" size={16} /><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model ID" /></label><label className="search-input"><Icon name="buildings" size={16} /><input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Provider" /></label><label className="search-input"><Icon name="app" size={16} /><input value={application} onChange={(event) => setApplication(event.target.value)} placeholder="Application" /></label><button type="button" className="primary-button compact-button" onClick={() => void load()}><Icon name="filter" size={15} /> Apply</button></div></Surface>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <Surface className="requests-surface"><div className="surface-heading"><div><Eyebrow>LIVE STREAM / NORMALIZED</Eyebrow><h2>Gateway requests</h2></div><span className="surface-meta"><span className="live-pulse" /> Refresh to fetch latest</span></div>{loading ? <LoadingLine /> : rows.length ? <RequestTable rows={rows} onSelect={(row) => void select(row)} /> : <EmptyState icon="list" title="No requests match these filters" detail="Try clearing a filter or wait for traffic to reach the gateway." />}</Surface>
    {selected && <RequestDetailPanel detail={detail} fallback={selected} onClose={() => { setSelected(null); setDetail(null); }} />}
  </div>;
}

function RequestDetailPanel({ detail, fallback, onClose }: { detail: RequestDetail | null; fallback: GatewayRequest; onClose: () => void }) {
  const row = detail ?? fallback;
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-panel" aria-label="Request detail"><div className="detail-header"><div><Eyebrow>REQUEST DETAIL</Eyebrow><h2>{shortId(row.request_id, 12)}</h2></div><button type="button" className="icon-button" aria-label="Close detail" onClick={onClose}><Icon name="close" size={18} /></button></div>{!detail ? <LoadingLine /> : <><div className="detail-hero"><span className={`large-status ${row.status_code >= 400 ? "error" : "ok"}`}><Icon name={row.status_code >= 400 ? "warning" : "check"} size={19} /></span><div><strong>{row.model_id || "Gateway endpoint"}</strong><span>{humanFinishReason(row.finish_reason)} · {row.status_code}</span></div></div><DetailSection title="Request metadata"><DetailGrid items={[["Request ID", row.request_id], ["Generation ID", row.generation_id || "Not reported"], ["Timestamp", formatDate(row.created_at)], ["API token", row.gateway_key_name || "Unattributed"], ["Application", row.application || "Not reported"], ["Endpoint", `${row.method} ${row.path}`], ["Streaming", row.streaming ? "Enabled" : "Disabled"], ["Reasoning", row.reasoning_used ? "Used" : "Not used"], ["Tools", row.tools_called ? "Called" : "Not called"], ["Fallback", row.fallback_used ? "Used" : "Not used"]]} /></DetailSection><DetailSection title="Model information"><div className="model-detail-banner">{row.provider_id && <ProviderMark name={row.provider_id} size="md" />}<div><strong>{detail?.model_display_name || row.model_id || "Unknown model"}</strong><span>{detail?.provider_name || row.provider_id || "Unknown provider"} · {humanCategory(row.model_category)}</span></div></div>{detail && <div className="capability-row">{detail.supports_vision ? <Capability label="Vision" icon="eye" /> : null}{detail.supports_tools ? <Capability label="Tools" icon="stack" /> : null}{detail.supports_reasoning ? <Capability label="Reasoning" icon="lightning" /> : null}{detail.context_window ? <Capability label={`${formatNumber(detail.context_window)} context`} icon="cube" /> : null}</div>}</DetailSection><DetailSection title="Latency"><DetailGrid items={[["Routing latency", formatDuration(row.routing_latency_ms)], ["Provider execution", formatDuration(row.provider_latency_ms)], ["Total latency", formatDuration(row.total_latency_ms)], ["Time to first token", formatDuration(row.time_to_first_token_ms)], ["Generation speed", row.tokens_per_second ? `${row.tokens_per_second.toFixed(1)} tok/s` : "Not reported"]]} /></DetailSection><DetailSection title="Tokens and cost"><div className="token-detail-grid"><DetailMetric label="Input tokens" value={formatNumber(row.input_tokens)} /><DetailMetric label="Output tokens" value={formatNumber(row.output_tokens)} /><DetailMetric label="Total tokens" value={formatNumber(row.total_tokens)} /><DetailMetric label="Cache read" value={formatNumber(row.cache_read_tokens)} /><DetailMetric label="Estimated cost" value={formatCurrency(row.cost)} /><DetailMetric label="Finish reason" value={humanFinishReason(row.finish_reason)} /></div></DetailSection>{row.error_message && <div className="detail-error"><Icon name="warning" size={15} /><span>{row.error_message}</span></div>}</>}</aside></div>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section>; }
function DetailGrid({ items }: { items: Array<[string, string]> }) { return <div className="detail-grid">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }
function DetailMetric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Capability({ label, icon }: { label: string; icon: "eye" | "stack" | "lightning" | "cube" }) { return <span className="capability"><Icon name={icon} size={13} />{label}</span>; }
