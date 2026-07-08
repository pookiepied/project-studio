/**
 * Manages Composio app connections: listing, connecting, toggling, disconnecting,
 * OAuth polling, and cache refresh.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  listConnections,
  listComposioApps,
  connectApp,
  disconnectApp,
  toggleConnection,
  refreshComposioAppsCache,
  type ComposioApp,
  type ComposioConnection,
} from "@/services/ai/composioService";
import { environmentService } from "@/services/platform/environmentService";
import { useAuth } from "@/contexts/AuthContext";

export interface UseComposioReturn {
  // State
  composioConnections:   ComposioConnection[];
  composioApps:          ComposioApp[];
  composioAppsLoading:   boolean;
  composioConnecting:    string | null;
  composioPolling:       Set<string>;
  composioCacheRefreshing: boolean;
  // Grouped derived data (uses raw search string passed in)
  composioFilteredApps:       (search: string) => ComposioApp[];
  groupedComposioApps:        (search: string) => [string, ComposioApp[]][];
  groupedComposioConnections: [string, ComposioConnection[]][];
  // Handlers
  handleRefreshComposioLogos: () => Promise<void>;
  handleComposioConnect:      (appName: string) => Promise<void>;
  handleComposioToggle:       (connectionId: string, enabled: boolean) => Promise<void>;
  handleComposioDisconnect:   (connectionId: string, appName?: string) => Promise<void>;
}

export function useComposio(onError: (msg: string) => void): UseComposioReturn {
  const { isAuthenticated } = useAuth();
  const isTauri = environmentService.isTauri();

  const [composioConnections,     setComposioConnections]     = useState<ComposioConnection[]>([]);
  const [composioApps,            setComposioApps]            = useState<ComposioApp[]>([]);
  const [composioAppsLoading,     setComposioAppsLoading]     = useState(true);
  const [composioConnecting,      setComposioConnecting]      = useState<string | null>(null);
  const [composioPolling,         setComposioPolling]         = useState<Set<string>>(new Set());
  const [composioCacheRefreshing, setComposioCacheRefreshing] = useState(false);
  const pollingIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const loadComposioData = useCallback(async () => {
    if (!isAuthenticated) return;
    setComposioAppsLoading(true);
    try {
      const [conns, apps] = await Promise.all([
        listConnections().catch(() => ({ items: [] as ComposioConnection[] })),
        listComposioApps().catch(() => ({ items: [] as ComposioApp[], totalPages: 1, totalCount: 0 })),
      ]);
      setComposioConnections(conns.items ?? []);
      setComposioApps(apps.items ?? []);
    } catch { /* non-fatal */ } finally {
      setComposioAppsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { loadComposioData(); }, [loadComposioData]);

  // Clear all polling intervals on unmount
  useEffect(() => {
    const intervals = pollingIntervalsRef.current;
    return () => { intervals.forEach(clearInterval); intervals.clear(); };
  }, []);

  const stopPolling = useCallback((appName: string) => {
    const key = appName.toLowerCase();
    const id  = pollingIntervalsRef.current.get(key);
    if (id !== undefined) { clearInterval(id); pollingIntervalsRef.current.delete(key); }
    setComposioPolling(prev => { const next = new Set(prev); next.delete(key); return next; });
  }, []);

  const handleRefreshComposioLogos = async () => {
    if (composioCacheRefreshing) return;
    setComposioCacheRefreshing(true);
    try { await refreshComposioAppsCache(); await loadComposioData(); }
    catch { /* non-fatal */ } finally { setComposioCacheRefreshing(false); }
  };

  const handleComposioConnect = async (appName: string) => {
    setComposioConnecting(appName);
    try {
      const result = await connectApp(appName);
      if (result.redirectUrl) {
        if (isTauri) {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(result.redirectUrl);
        } else {
          window.open(result.redirectUrl, "_blank");
        }
        // Poll every 5s (up to 2 min) waiting for ACTIVE
        const key = appName.toLowerCase();
        setComposioPolling(prev => new Set(prev).add(key));
        let attempts = 0;
        const id = setInterval(async () => {
          attempts++;
          try {
            const conns = await listConnections();
            setComposioConnections(conns.items ?? []);
            const active = conns.items?.find(c => c.appName.toLowerCase() === key && c.status === "ACTIVE");
            if (active || attempts >= 24) stopPolling(appName);
          } catch { if (attempts >= 24) stopPolling(appName); }
        }, 5000);
        pollingIntervalsRef.current.set(key, id);
      } else {
        await loadComposioData();
      }
    } catch (e: any) {
      onError(`Failed to connect ${appName}: ${e.message ?? String(e)}`);
    } finally {
      setComposioConnecting(null);
    }
  };

  const handleComposioToggle = async (connectionId: string, enabled: boolean) => {
    try {
      await toggleConnection(connectionId, enabled);
      setComposioConnections(prev => prev.map(c => c.id === connectionId ? { ...c, enabled } : c));
    } catch (e: any) { onError(`Failed to update connection: ${e.message ?? String(e)}`); }
  };

  const handleComposioDisconnect = async (connectionId: string, appName?: string) => {
    try {
      if (appName) stopPolling(appName);
      await disconnectApp(connectionId);
      setComposioConnections(prev => prev.filter(c => c.id !== connectionId));
    } catch (e: any) { onError(`Failed to disconnect: ${e.message ?? String(e)}`); }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const composioFilteredApps = useCallback((search: string): ComposioApp[] => {
    const q = search.trim().toLowerCase();
    if (!q) return composioApps;
    return composioApps.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.categories?.some(c => c.toLowerCase().includes(q))
    );
  }, [composioApps]);

  const groupedComposioApps = useCallback((search: string): [string, ComposioApp[]][] => {
    const filtered = composioFilteredApps(search);
    const groups: Record<string, ComposioApp[]> = {};
    for (const app of filtered) {
      const key = app.curatedCategory ?? "Other";
      (groups[key] ??= []).push(app);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "Google Workspace") return -1;
      if (b === "Google Workspace") return 1;
      return a.localeCompare(b);
    });
  }, [composioFilteredApps]);

  const groupedComposioConnections = useMemo((): [string, ComposioConnection[]][] => {
    const groups: Record<string, ComposioConnection[]> = {};
    for (const conn of composioConnections) {
      const appData = composioApps.find(a => a.appId.toLowerCase() === conn.appName.toLowerCase());
      const key = appData?.curatedCategory ?? "Apps";
      (groups[key] ??= []).push(conn);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (a.displayName || a.appName).localeCompare(b.displayName || b.appName));
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === "Google Workspace") return -1;
      if (b === "Google Workspace") return 1;
      return a.localeCompare(b);
    });
  }, [composioConnections, composioApps]);

  return {
    composioConnections, composioApps, composioAppsLoading,
    composioConnecting, composioPolling, composioCacheRefreshing,
    composioFilteredApps, groupedComposioApps, groupedComposioConnections,
    handleRefreshComposioLogos,
    handleComposioConnect, handleComposioToggle, handleComposioDisconnect,
  };
}
