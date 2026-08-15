import { useEffect, useState } from "react"
import { gatewayApi, type AnalyticsOverview, type AnalyticsRange, type GatewayRequest } from "../lib/api"
import { formatCurrency, formatDate, formatDuration, formatNumber, formatDay, humanCategory, humanFinishReason, shortId } from "../lib/format"
import { Activity, ArrowClockwise, ArrowUpRight, Gauge, Info, Key, Stack, Coins, Lightning } from "@/components/icons"
import { EmptyState, ErrorState, Eyebrow, LoadingLine, ProviderMark, SectionHeading, StatusDot, Surface } from "../components/ui"
import type { Section } from "@/app/navigation/GatewayNavigation"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Button } from "@/components/ui/button"

type ChartMetric = "requests" | "tokens" | "cost"

export function DashboardPage({ onNavigate }: { onNavigate: (section: Section) => void }) {
  const [range, setRange] = useState<AnalyticsRange>("30d")
  const [data, setData] = useState<AnalyticsOverview | null>(null)
  const [recent, setRecent] = useState<GatewayRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load(nextRange = range) {
    setLoading(true)
    setError("")
    try {
      const [overview, requests] = await Promise.all([gatewayApi.overview(nextRange), gatewayApi.requests("limit=6")])
      setData(overview)
      setRecent(requests.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load gateway analytics")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [range])

  const summary = data?.summary
  return <div className="page-frame">
      <SectionHeading eyebrow="OPERATIONS / OVERVIEW" title="Gateway overview" detail="A clear read on traffic, model utilization, and service performance." action={<div className="heading-actions"><SegmentedControl ariaLabel="Analytics range" value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} /><Button variant="outline" size="icon-sm" aria-label="Refresh analytics" onClick={() => void load()}><ArrowClockwise size="sm" /></Button></div>} />
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {loading && !data ? <div className="dashboard-loading"><LoadingLine /><LoadingLine /><LoadingLine /></div> : <>
      <div className="metric-grid">
        <MetricCard icon={Activity} label="Requests" value={formatNumber(summary?.totalRequests)} detail={`${formatNumber(summary?.successfulRequests)} successful`} tone="dark" />
        <MetricCard icon={Stack} label="Total tokens" value={formatNumber(summary?.totalTokens)} detail={`${formatNumber(summary?.inputTokens)} in · ${formatNumber(summary?.outputTokens)} out`} />
        <MetricCard icon={Coins} label="Estimated cost" value={formatCurrency(summary?.cost)} detail="Normalized from model pricing" />
        <MetricCard icon={Lightning} label="Cache read rate" value={`${((summary?.cacheReadRate ?? 0) * 100).toFixed(1)}%`} detail={`${formatNumber(summary?.cacheReadTokens)} cached tokens`} />
      </div>
      <div className="dashboard-grid primary-grid">
          <Surface className="chart-surface"><div className="surface-heading"><div><Eyebrow>REQUEST VOLUME</Eyebrow><h2>Traffic over time</h2></div><span className="surface-meta"><StatusDot status="healthy" /> Live data</span></div><RequestChart points={data?.timeseries ?? []} /></Surface>
        <Surface className="performance-surface"><div className="surface-heading"><div><Eyebrow>PERFORMANCE</Eyebrow><h2>Gateway speed</h2></div><Gauge size="sm" className="text-muted-foreground" /></div><div className="performance-list"><PerformanceRow label="Average latency" value={formatDuration(summary?.avgLatencyMs)} /><PerformanceRow label="Provider execution" value={formatDuration(summary?.avgProviderLatencyMs)} /><PerformanceRow label="Routing overhead" value={formatDuration(summary?.avgRoutingLatencyMs)} /><PerformanceRow label="Time to first token" value={formatDuration(summary?.avgTimeToFirstTokenMs)} /><PerformanceRow label="Generation speed" value={`${(summary?.avgTokensPerSecond ?? 0).toFixed(1)} tok/s`} /></div><div className="latency-note"><Info size="xs" /> Routing and provider timings are stored separately for each request.</div></Surface>
      </div>
      <div className="dashboard-grid secondary-grid">
        <Surface><div className="surface-heading"><div><Eyebrow>MODEL UTILIZATION</Eyebrow><h2>What is doing the work</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate("models")}>Manage models <ArrowUpRight size="xs" /></Button></div>{data?.models.length ? <div className="utilization-list">{data.models.slice(0, 6).map((model) => <div className="utilization-row" key={`${model.provider_id}/${model.model_id}`}><ProviderMark name={model.provider_id} size="sm" /><div className="utilization-name"><strong>{model.model_id}</strong><span>{humanCategory(model.model_category)} · {formatDuration(model.avg_latency_ms)}</span></div><div className="utilization-bar"><span style={{ width: `${percentage(model.requests, data.models[0]?.requests)}%` }} /></div><strong className="utilization-count">{formatNumber(model.requests)}</strong></div>)}</div> : <EmptyState icon="cube" title="No model traffic yet" detail="Deployed model requests will be grouped here." action={<Button variant="outline" size="sm" onClick={() => onNavigate("models")}>Review catalog</Button>} />}</Surface>
        <Surface><div className="surface-heading"><div><Eyebrow>CONSUMER ACTIVITY</Eyebrow><h2>Who is using the gateway</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate("tokens")}>API tokens <ArrowUpRight size="xs" /></Button></div>{data?.tokens.length ? <div className="token-list">{data.tokens.slice(0, 5).map((token) => <div className="token-row" key={token.gateway_key_id}><span className="token-glyph"><Key size="sm" /></span><div><strong>{token.gateway_key_name || "Unnamed token"}</strong><span>{formatNumber(token.requests)} requests · {formatNumber(token.total_tokens)} tokens</span></div><span className="token-cost">{formatCurrency(token.cost)}</span></div>)}</div> : <EmptyState icon="key" title="No token activity yet" detail="Issue an API token to start attributing gateway traffic." action={<Button variant="outline" size="sm" onClick={() => onNavigate("tokens")}>Manage tokens</Button>} />}</Surface>
      </div>
      <Surface className="recent-surface"><div className="surface-heading"><div><Eyebrow>REQUEST STREAM</Eyebrow><h2>Latest requests</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate("requests")}>Open request explorer <ArrowUpRight size="xs" /></Button></div>{recent.length ? <RequestTable rows={recent} compact /> : <EmptyState icon="list" title="The request stream is quiet" detail="When the first gateway request arrives, its lifecycle and normalized usage will appear here." />}</Surface>
    </>}
  </div>
}

function MetricCard({ icon: Glyph, label, value, detail, tone = "light" }: { icon: React.ComponentType<{ size?: any; className?: string }>; label: string; value: string; detail: string; tone?: "light" | "dark" }) {
  return <Surface className={`metric-card metric-${tone}`}><span className="metric-icon"><Glyph size="sm" /></span><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span></Surface>
}

function RequestChart({ points }: { points: AnalyticsOverview["timeseries"] }) {
  const [metric, setMetric] = useState<ChartMetric>("requests")
  const [hovered, setHovered] = useState<number | null>(null)
  if (!points.length) return <div className="chart-empty"><div className="chart-empty-line" /><span>No request records in this time window</span></div>
  const width = 760
  const height = 250
  const inset = { left: 42, right: 14, top: 18, bottom: 30 }
  const plotWidth = width - inset.left - inset.right
  const plotHeight = height - inset.top - inset.bottom
  const values = points.map((point) => metric === "requests" ? Number(point.requests) || 0 : metric === "tokens" ? Number(point.total_tokens) || 0 : Number(point.cost) || 0)
  const max = Math.max(...values, 1)
  const x = (index: number) => inset.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const y = (value: number) => inset.top + plotHeight - (value / max) * plotHeight
  const line = points.map((_, index) => `${x(index)},${y(values[index])}`).join(" ")
  const area = `${inset.left},${inset.top + plotHeight} ${line} ${inset.left + plotWidth},${inset.top + plotHeight}`
  const hoveredPoint = hovered === null ? null : { point: points[hovered], value: values[hovered], x: x(hovered), y: y(values[hovered]) }
  const valueLabel = (value: number) => metric === "cost" ? formatCurrency(value) : formatNumber(value)
  return <div className="request-chart request-chart-modern">
    <div className="chart-toolbar"><span className="chart-summary"><strong>{valueLabel(values.reduce((sum, value) => sum + value, 0))}</strong><span>{metric === "requests" ? "requests" : metric === "tokens" ? "tokens" : "estimated cost"}</span></span><SegmentedControl ariaLabel="Chart metric" value={metric} onChange={setMetric} options={[{ value: "requests", label: "Requests" }, { value: "tokens", label: "Tokens" }, { value: "cost", label: "Cost" }]} /></div>
    <div className="chart-stage" onPointerLeave={() => setHovered(null)} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); const relative = Math.max(0, Math.min(1, (event.clientX - bounds.left - (bounds.width * inset.left / width)) / (bounds.width * plotWidth / width))); setHovered(Math.round(relative * Math.max(points.length - 1, 0))) }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} over time`} preserveAspectRatio="none">
        <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".16" /><stop offset=".9" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        {[0, 0.33, 0.66, 1].map((step) => <line key={step} x1={inset.left} x2={inset.left + plotWidth} y1={inset.top + plotHeight * step} y2={inset.top + plotHeight * step} className="chart-grid-line" />)}
        <polygon points={area} fill="url(#chart-fill)" />
        <polyline points={line} fill="none" className="chart-line" />
        {hoveredPoint && <><line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={inset.top} y2={inset.top + plotHeight} className="chart-hover-line" /><circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" className="chart-hover-dot" /></>}
      </svg>
      {hoveredPoint && <div className="chart-tooltip" style={{ left: `${(hoveredPoint.x / width) * 100}%`, top: `${(hoveredPoint.y / height) * 100}%` }}><strong>{valueLabel(hoveredPoint.value)}</strong><span>{formatDay(hoveredPoint.point.day)}</span></div>}
    </div>
    <div className="chart-axis"><span>{formatDay(points[0].day)}</span><span>{formatDay(points[Math.floor(points.length / 2)].day)}</span><span>{formatDay(points[points.length - 1].day)}</span></div>
  </div>
}

function PerformanceRow({ label, value }: { label: string; value: string }) {
  return <div className="performance-row"><span>{label}</span><strong>{value}</strong></div>
}

function percentage(value: number, max: number | undefined): number { return Math.max(4, Math.min(100, ((value || 0) / Math.max(max || 1, 1)) * 100)) }

export function RequestTable({ rows, compact = false, onSelect }: { rows: GatewayRequest[]; compact?: boolean; onSelect?: (request: GatewayRequest) => void }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Model</th><th>Consumer</th><th>Status</th><th>Tokens</th><th>Latency</th><th>When</th></tr></thead><tbody>{rows.map((row) => <tr key={row.request_id} onClick={() => onSelect?.(row)} className={onSelect ? "clickable-row" : ""}><td><div className="request-id"><span className={`request-status ${row.status_code >= 400 ? "error" : "ok"}`} /><code>{shortId(row.request_id)}</code><span>{row.path}</span></div></td><td><div className="model-cell">{row.provider_id && <ProviderMark name={row.provider_id} size="sm" />}<div><strong>{row.model_id || "Gateway endpoint"}</strong><span>{humanCategory(row.model_category)}</span></div></div></td><td>{row.gateway_key_name || row.application || <span className="muted">Unattributed</span>}</td><td><span className={`status-badge ${row.status_code >= 400 ? "danger" : "success"}`}>{row.status_code >= 400 ? "Failed" : humanFinishReason(row.finish_reason)}</span></td><td>{formatNumber(row.total_tokens)}</td><td>{formatDuration(row.total_latency_ms)}</td><td className="muted">{compact ? formatDate(row.created_at) : formatDate(row.created_at)}</td></tr>)}</tbody></table></div>
}
