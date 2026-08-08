import { useCallback, useEffect, useRef, useState } from "react";
import { createHeaders } from "@/lib/api";
import { apiManager } from "@/core/network/apiManager";
import { logger } from "@/core/logging/logger";
import { prefetchProfiles } from "@/core/network/userProfileCache";
import type { AuthHealth, LogEntry, SummaryData, SystemStatus, UsageRow } from "../types";
import { fillDailyGaps } from "../formatters";

interface UseActivityDataOptions {
  days: number;
  providerFilter: string;
}

export function useActivityData({ days, providerFilter }: UseActivityDataOptions) {
  const [systemHealth, setSystemHealth] = useState<SystemStatus | null>(null);
  const [authHealth, setAuthHealth] = useState<AuthHealth | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [chartData, setChartData] = useState<UsageRow[]>([]);
  const [providerData, setProviderData] = useState<UsageRow[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [personalSummary, setPersonalSummary] = useState<SummaryData | null>(null);

  const [loadingHealth, setLoadingHealth] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingPersonal, setLoadingPersonal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const endpoints = await apiManager.getEndpoints();
      const statusUrl = endpoints.health.replace(/\/health$/, "") + "/system/status";
      const [statusRes, authRes] = await Promise.allSettled([
        fetch(statusUrl),
        fetch(`${endpoints.auth}/health`),
      ]);
      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        setSystemHealth(await statusRes.value.json() as SystemStatus);
      }
      if (authRes.status === "fulfilled" && authRes.value.ok) {
        setAuthHealth(await authRes.value.json() as AuthHealth);
      }
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
      const uniqueIds = [...new Set(events.map((event) => event.user_id).filter(Boolean))];
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

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      fetchHealth(),
      fetchSummary(),
      fetchChart(),
      fetchProviders(),
      fetchLogs(),
      fetchPersonal(),
    ]);
    setIsRefreshing(false);
  }, [fetchHealth, fetchSummary, fetchChart, fetchProviders, fetchLogs, fetchPersonal]);

  return {
    systemHealth,
    authHealth,
    summary,
    chartData,
    providerData,
    logs,
    personalSummary,
    loadingHealth,
    loadingChart,
    loadingProviders,
    loadingLogs,
    loadingPersonal,
    error,
    isRefreshing,
    handleRefresh,
  };
}
