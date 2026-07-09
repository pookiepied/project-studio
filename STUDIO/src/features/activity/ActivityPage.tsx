import { useState, useEffect, useCallback, useRef } from "react";
import { ChartLineUp, TerminalWindow, Robot } from "@phosphor-icons/react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Icon, Refresh, Warning } from "@/components/icons";
import { IconButton } from "@/components/ui/IconButton";
import { createHeaders } from "@/utils/api";
import { apiManager } from "@/core/network/apiManager";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { isResolvedDark } from "@/utils/theme";
import { logger } from "@/core/logging/logger";
import { prefetchProfiles } from "@/core/network/userProfileCache";

import type {
  SystemStatus, AuthHealth, SummaryData, UsageRow, LogEntry,
  ChartMetric, ActivityMode,
} from "./types";
import { fmtTokens, fmtCost, fmtShortDate, fmtMetricValue, fillDailyGaps } from "./formatters";
import { ProviderCard, ChartTooltip, LogRow, HealthCard } from "./components";

export const ActivityPage = () => {
  const { user } = useAuth();
  const { settings } = useSettings();
  const isDark = isResolvedDark(settings.theme);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<ChartMetric>("requests");
  const [providerFilter, setProviderFilter] = useState("all");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mode, setMode] = useState<ActivityMode>("gateway");

  // ── Data state ────────────────────────────────────────────────────────────
  const [systemHealth, setSystemHealth] = useState<SystemStatus | null>(null);
  const [authHealth, setAuthHealth] = useState<AuthHealth | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [chartData, setChartData] = useState<UsageRow[]>([]);
  const [providerData, setProviderData] = useState<UsageRow[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [personalSummary, setPersonalSummary] = useState<SummaryData | null>(null);

  // ── Loading state ─────────────────────────────────────────────────────────
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingPersonal, setLoadingPersonal] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const endpoints = await apiManager.getEndpoints();
      const statusUrl = endpoints.health.replace(/\/health$/, "") + "/system/status";
      const [statusRes, authRes] = await Promise.allSettled([
        fetch(statusUrl),
        fetch(`${endpoints.auth}/health`),
      ]);
      if (statusRes.status === "fulfilled" && statusRes.value.ok)
        setSystemHealth(await statusRes.value.json() as SystemStatus);
      if (authRes.status === "fulfilled" && authRes.value.ok)
        setAuthHealth(await authRes.value.json() as AuthHealth);
    } catch (err) {
      logger.error("ActivityPage", "health fetch failed", err);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    setError(null);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(endpoints.tracking.summary, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      setSummary(await res.json() as SummaryData);
    } catch (err) {
      logger.error("ActivityPage", "summary fetch failed", err);
      setError("Could not load activity data.");
    }
  }, []);

  const fetchChart = useCallback(async () => {
    setLoadingChart(true);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const params = new URLSearchParams({ group_by: "day", days: String(days) });
      if (providerFilter !== "all") params.set("provider", providerFilter);
      const res = await fetch(`${endpoints.tracking.usage}?${params}`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { data: UsageRow[] };
      const enriched = (data.data ?? []).map((row) => ({
        ...row,
        error_rate: row.requests > 0 ? Math.round((row.error_count / row.requests) * 1000) / 10 : 0,
      }));
      setChartData(fillDailyGaps(enriched, days));
    } catch (err) {
      logger.error("ActivityPage", "chart fetch failed", err);
    } finally {
      setLoadingChart(false);
    }
  }, [days, providerFilter]);

  const fetchProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const params = new URLSearchParams({ group_by: "provider", days: "30" });
      const res = await fetch(`${endpoints.tracking.usage}?${params}`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { data: UsageRow[] };
      setProviderData(data.data ?? []);
    } catch (err) {
      logger.error("ActivityPage", "providers fetch failed", err);
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const params = new URLSearchParams({ limit: "50" });
      if (providerFilter !== "all") params.set("provider", providerFilter);
      const res = await fetch(`${endpoints.tracking.logs}?${params}`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { events: LogEntry[] };
      const events = data.events ?? [];
      const uniqueIds = [...new Set(events.map((e) => e.user_id).filter(Boolean))];
      if (uniqueIds.length > 0) prefetchProfiles(uniqueIds);
      setLogs(events);
    } catch (err) {
      logger.error("ActivityPage", "logs fetch failed", err);
    } finally {
      setLoadingLogs(false);
    }
  }, [providerFilter]);

  const fetchPersonal = useCallback(async () => {
    setLoadingPersonal(true);
    try {
      const [endpoints, headers] = await Promise.all([apiManager.getEndpoints(), createHeaders()]);
      const res = await fetch(endpoints.tracking.me, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      setPersonalSummary(await res.json() as SummaryData);
    } catch (err) {
      logger.error("ActivityPage", "personal summary fetch failed", err);
    } finally {
      setLoadingPersonal(false);
    }
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => { fetchHealth(); }, [fetchHealth]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchProviders(); }, [fetchProviders]);
  useEffect(() => { fetchChart(); }, [fetchChart]);
  useEffect(() => { setLoadingLogs(true); fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchPersonal(); }, [fetchPersonal]);

  useEffect(() => {
    pollingRef.current = setInterval(fetchLogs, 15_000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchLogs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchHealth(), fetchSummary(), fetchChart(), fetchProviders(), fetchLogs(), fetchPersonal()]);
    setIsRefreshing(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const stats = summary;
  const credits = summary?.credits ?? [];
  const creditMap = new Map(credits.map((c) => [c.provider, c]));
  const personalStats = personalSummary;
  const comp = systemHealth?.components ?? {};
  const jobs = systemHealth?.metrics?.jobs;

  const derivedStats = (() => {
    if (chartData.length === 0) return null;
    const t = chartData.reduce(
      (a, r) => ({
        requests: a.requests + r.requests,
        input_tokens: a.input_tokens + r.input_tokens,
        output_tokens: a.output_tokens + r.output_tokens,
        cost_usd: r.cost_usd != null ? (a.cost_usd ?? 0) + r.cost_usd : a.cost_usd,
        error_count: a.error_count + r.error_count,
      }),
      { requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: null as number | null, error_count: 0 }
    );
    return {
      ...t,
      success_rate: t.requests > 0
        ? Math.round(((t.requests - t.error_count) / t.requests) * 1000) / 10
        : null,
    };
  })();

  // Chart geometry colours — neutral, on-ramp values. recharts needs literal
  // colour strings (no CSS classes), so these are the documented data-viz
  // exception (D-401): they carry no semantic hue, only neutral greys.
  /* eslint-disable no-restricted-syntax */
  const chartBarColor = isDark ? "#A3A3A3" : "#737373";
  const gridColor    = "var(--surface-raised)";
  const axisColor    = isDark ? "#525252" : "#737373";
  /* eslint-enable no-restricted-syntax */

  const CHART_METRICS: Array<{ key: ChartMetric; label: string }> = [
    { key: "requests",     label: "Req"  },
    { key: "input_tokens", label: "In"   },
    { key: "output_tokens",label: "Out"  },
    { key: "cost_usd",     label: "$"    },
    { key: "error_rate",   label: "Err%" },
  ];

  const xAxisInterval = days === 7 ? 0 : days === 14 ? 1 : 2;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-surface-page overflow-hidden transition-colors duration-normal">

      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-surface-border relative flex items-center">
        <div className="flex items-center gap-2">
          <Icon icon={ChartLineUp} size="md" className="text-muted" />
          <span className="text-xl font-display font-normal text-primary">Activity</span>
          <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
        </div>

        <div className="absolute left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-0.5 bg-surface-base rounded-md p-0.5">
            {([
              { key: "gateway", label: "Gateway" },
              { key: "agents",  label: "Agents"  },
              { key: "system",  label: "System"  },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setMode(tab.key)}
                className={`px-3 py-0.5 text-2xs rounded transition-colors duration-fast font-sans ${
                  mode === tab.key
                    ? "bg-surface-raised text-primary font-semibold shadow-sm"
                    : "text-muted hover:text-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <IconButton
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh activity data"
          variant="ghost"
          size="sm"
          title="Refresh"
          className="ml-auto"
        >
          <Refresh size="sm" className={isRefreshing ? "animate-spin" : ""} />
        </IconButton>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto scrollbar-auto-hide px-5 py-4 space-y-5">

        {/* GATEWAY mode */}
        {mode === "gateway" && (
          <>
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-raised border border-surface-border">
                <Warning size="sm" weight="fill" className="text-primary flex-shrink-0" />
                <span className="text-xs text-secondary">{error}</span>
              </div>
            )}

            {/* Chart + Stats */}
            <section>
              <div className="rounded-xl border border-surface-border bg-surface-base p-4 transition-colors duration-normal">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-medium text-muted uppercase tracking-wider font-sans">
                      Request Volume
                    </span>
                    {!loadingChart && derivedStats && derivedStats.success_rate != null && (
                      <>
                        <svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90 flex-shrink-0">
                          <circle cx="7" cy="7" r="5" fill="none" stroke="var(--surface-border)" strokeWidth="2" />
                          <circle cx="7" cy="7" r="5" fill="none"
                            stroke="var(--text-secondary)"
                            strokeWidth="2" strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 5}`}
                            strokeDashoffset={`${2 * Math.PI * 5 * (1 - derivedStats.success_rate / 100)}`}
                            style={{ transition: "stroke-dashoffset 0.5s ease" }}
                          />
                        </svg>
                        {derivedStats.success_rate < 95 && (
                          <Warning size="xs" weight="fill" className="text-primary flex-shrink-0" />
                        )}
                        <span className="text-2xs font-semibold font-sans text-primary">
                          {derivedStats.success_rate}%
                        </span>
                        {derivedStats.error_count > 0 && (
                          <span className="text-2xs text-muted">
                            · {derivedStats.error_count} err
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`px-2 py-0.5 text-2xs rounded transition-colors duration-fast ${
                          days === d
                            ? "bg-surface-selected text-primary font-medium"
                            : "text-muted hover:text-secondary"
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                    <div className="w-px h-3 bg-surface-border mx-0.5" />
                    {CHART_METRICS.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => setMetric(m.key)}
                        className={`px-2 py-0.5 text-2xs rounded transition-colors duration-fast ${
                          metric === m.key
                            ? "bg-surface-selected text-primary font-medium"
                            : "text-muted hover:text-secondary"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {loadingChart ? (
                  <div className="h-[160px] flex items-center justify-center">
                    <span className="text-xs text-muted animate-pulse">Loading chart…</span>
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="h-[160px] flex items-center justify-center">
                    <span className="text-xs text-muted">No data for this period</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap="15%">
                      <CartesianGrid strokeDasharray="0" stroke={gridColor} horizontal vertical={false} />
                      <XAxis dataKey="label" tickFormatter={fmtShortDate} tick={{ fontSize: 9, fill: axisColor }} axisLine={false} tickLine={false} interval={xAxisInterval} />
                      <YAxis tick={{ fontSize: 9, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtMetricValue(metric, v)} width={46} />
                      <Tooltip
                        content={(props) => (
                          <ChartTooltip
                            active={props.active}
                            payload={props.payload as unknown as Array<{ value: number }>}
                            label={props.label as string}
                            metric={metric}
                          />
                        )}
                        cursor={{ fill: isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}
                      />
                      <Bar dataKey={metric} fill={chartBarColor} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {/* Stats row */}
                <div className="mt-4 pt-3 border-t border-surface-border grid grid-cols-4 gap-4">
                  {[
                    { key: "Requests",   val: loadingChart ? "—" : String(derivedStats?.requests ?? 0) },
                    { key: "Cost",       val: loadingChart ? "—" : fmtCost(derivedStats?.cost_usd ?? null, 3) ?? "—" },
                    { key: "In Tokens",  val: loadingChart ? "—" : fmtTokens(derivedStats?.input_tokens ?? null) },
                    { key: "Out Tokens", val: loadingChart ? "—" : fmtTokens(derivedStats?.output_tokens ?? null) },
                  ].map(({ key, val }) => (
                    <div key={key}>
                      <div className="text-2xs font-medium text-muted uppercase tracking-wider font-sans mb-1.5">{key}</div>
                      <div className="text-base font-semibold text-primary font-sans leading-none">{val}</div>
                      <div className="text-2xs text-muted mt-1">{days}d</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Provider cards */}
            {(loadingProviders || providerData.length > 0) && (
              <section>
                <div className="text-2xs font-medium text-muted uppercase tracking-wider mb-2 font-sans">
                  Providers · 30d
                </div>
                {loadingProviders ? (
                  <div className="flex gap-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="w-44 h-36 flex-shrink-0 rounded-xl bg-surface-base border border-surface-border animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
                    {providerData.map((row) => (
                      <ProviderCard
                        key={row.label}
                        row={row}
                        credit={creditMap.get(row.label)}
                        isActive={providerFilter === row.label}
                        onClick={() => setProviderFilter((prev) => prev === row.label ? "all" : row.label)}
                      />
                    ))}
                  </div>
                )}
                {providerFilter !== "all" && (
                  <button
                    onClick={() => setProviderFilter("all")}
                    className="mt-2 text-xs text-muted hover:text-secondary transition-colors duration-fast"
                  >
                    Clear filter ×
                  </button>
                )}
              </section>
            )}

            {/* Current user card */}
            {user && (
              <section>
                <div className="text-2xs font-medium text-muted uppercase tracking-wider mb-2 font-sans">
                  Your Session
                </div>
                <div className="rounded-lg border border-surface-border bg-surface-base px-3 py-2 flex items-center gap-2.5 transition-colors duration-normal">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-surface-active flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-medium text-secondary">{user.name?.charAt(0) ?? "?"}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-primary truncate">{user.name}</div>
                    <div className="text-2xs text-muted truncate">{user.email}</div>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-3 text-right">
                    <div>
                      <div className="text-xs font-semibold text-secondary font-sans leading-none">
                        {loadingPersonal ? "—" : String(personalStats?.total_requests ?? 0)}
                      </div>
                      <div className="text-2xs text-muted mt-0.5">requests</div>
                    </div>
                    {!loadingPersonal && stats && personalStats && stats.total_requests > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-secondary font-sans leading-none">
                          {((personalStats.total_requests / stats.total_requests) * 100).toFixed(1)}%
                        </div>
                        <div className="text-2xs text-muted mt-0.5">of total</div>
                      </div>
                    )}
                    {!loadingPersonal && personalStats && personalStats.total_cost_usd != null && (
                      <div>
                        <div className="text-xs font-semibold text-secondary font-sans leading-none">
                          {fmtCost(personalStats.total_cost_usd, 3)}
                        </div>
                        <div className="text-2xs text-muted mt-0.5">spent</div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Request log */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Icon icon={TerminalWindow} size="xs" className="text-muted" />
                <span className="text-2xs font-medium text-muted uppercase tracking-wider font-sans">
                  Request Log
                </span>
                {!loadingLogs && (
                  <span className="text-2xs text-muted ml-auto">
                    {logs.length} events · 15s refresh
                  </span>
                )}
              </div>
              <div
                className="grid items-center gap-x-2 px-3 py-1 mb-0.5"
                style={{ gridTemplateColumns: "20px minmax(0, 1fr) minmax(0, 1fr) 80px 70px 14px" }}
              >
                <span />
                <span className="text-2xs text-muted uppercase tracking-wider">Time / Provider</span>
                <span className="text-2xs text-muted uppercase tracking-wider">Model / Source</span>
                <span className="text-2xs text-muted uppercase tracking-wider text-right">Tokens</span>
                <span className="text-2xs text-muted uppercase tracking-wider text-right">Cost</span>
                <span />
              </div>
              {loadingLogs ? (
                <div className="space-y-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-10 rounded-lg bg-surface-base animate-pulse" />
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Icon icon={TerminalWindow} size="xl" className="text-disabled mb-2" />
                  <span className="text-xs text-muted">No requests recorded yet</span>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((log) => (
                    <LogRow
                      key={log.id}
                      log={log}
                      isExpanded={expandedLogId === log.id}
                      onToggle={() => setExpandedLogId((prev) => prev === log.id ? null : log.id)}
                      currentUserSub={user?.id}
                      userPicture={user?.picture}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* AGENTS mode */}
        {mode === "agents" && (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="w-14 h-14 rounded-2xl bg-surface-base border border-surface-border flex items-center justify-center">
              <Icon icon={Robot} size="xl" className="text-muted" />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-secondary font-sans mb-1.5">No active agents</div>
              <div className="text-xs text-muted max-w-[260px] leading-relaxed">
                Agent runs, trace timelines, tool call sequences, and orchestration logs will appear here.
              </div>
            </div>
            <div className="w-full max-w-sm space-y-1.5 mt-2 pointer-events-none select-none">
              {[
                { indent: 0,  width: "85%" },
                { indent: 16, width: "65%" },
                { indent: 32, width: "55%" },
                { indent: 16, width: "70%" },
                { indent: 32, width: "48%" },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-2 opacity-20" style={{ paddingLeft: row.indent }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-muted flex-shrink-0" />
                  <div className="h-6 rounded-md bg-surface-border" style={{ width: row.width }} />
                </div>
              ))}
            </div>
            <span className="text-2xs text-disabled font-sans tracking-wider uppercase mt-2">
              Coming Soon
            </span>
          </div>
        )}

        {/* SYSTEM mode */}
        {mode === "system" && (
          <section>
            <div className="text-2xs font-medium text-muted uppercase tracking-wider mb-2 font-sans">
              System Health
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <HealthCard label="API Gateway"  status={comp.api?.status ?? "down"}      meta={comp.api?.message ?? undefined}       loading={loadingHealth} />
              <HealthCard label="Auth Service" status={authHealth?.status ?? "down"}     meta={authHealth ? `v${authHealth.version}` : undefined} loading={loadingHealth} />
              <HealthCard label="AI Worker"    status={comp.ai?.status ?? "down"}        meta={comp.ai?.metadata?.modelCount != null ? `${comp.ai.metadata.modelCount} models` : comp.ai?.message ?? undefined} loading={loadingHealth} />
              <HealthCard label="Database"     status={comp.database?.status ?? "down"}  meta={comp.database?.metadata?.responseTime != null ? `${comp.database.metadata.responseTime}ms` : comp.database?.message ?? undefined} loading={loadingHealth} />
            </div>
            {jobs && (
              <div className="mt-2 flex items-center gap-3 px-1">
                <span className="text-2xs text-muted font-sans uppercase tracking-wider">Job Metrics</span>
                {[
                  { label: "Queued Jobs", val: jobs.queued  },
                  { label: "Running",     val: jobs.running },
                  { label: "Done",        val: jobs.completed },
                  { label: "Failed",      val: jobs.failed  },
                ].map((j) => (
                  <div key={j.label} className="flex items-center gap-1">
                    <span className="text-2xs text-muted">{j.label}</span>
                    <span className={`text-2xs ${
                      j.label === "Failed" && j.val > 0 ? "text-primary font-semibold" : "text-secondary font-medium"
                    }`}>{j.val}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
};
