import { useState, useRef, useMemo, useCallback } from "react";
import type { BrowserTab } from "@/features/workspace/browser/BrowserPanel";

function makeWebLabel(url: string) {
  if (!url) return "New tab";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Page";
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function createWebTab(id: string, url = ""): BrowserTab {
  return {
    id,
    label: makeWebLabel(url),
    mode: "web",
    url,
    history: url ? [url] : [],
    historyIndex: url ? 0 : -1,
    reloadKey: 0,
    zoom: 1,
    deviceToolbar: false,
  };
}

export function useBrowserPanel() {
  const [browserPanelOpen,   setBrowserPanelOpen]   = useState(false);
  const [browserTabs,        setBrowserTabs]        = useState<BrowserTab[]>([]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState("");
  const [browserPanelWidth,  setBrowserPanelWidth]  = useState(480);
  const browserTabSeq = useRef(0);

  const createBrowserTab = useCallback((initialUrl = "") => {
    const id = `browser-${++browserTabSeq.current}`;
    const tab = createWebTab(id, normalizeUrl(initialUrl));
    setBrowserTabs(prev => [...prev, tab]);
    setActiveBrowserTabId(id);
    setBrowserPanelOpen(true);
    return id;
  }, []);

  const ensureBrowserTab = useCallback(() => {
    setBrowserPanelOpen(true);
    let ensuredId = "";
    setBrowserTabs(prev => {
      if (prev.length > 0) {
        ensuredId = activeBrowserTabId || prev[0].id;
        return prev;
      }
      const tab = createWebTab(`browser-${++browserTabSeq.current}`);
      ensuredId = tab.id;
      return [tab];
    });
    if (ensuredId) setActiveBrowserTabId(ensuredId);
  }, [activeBrowserTabId]);

  const navigateBrowserTab = useCallback((id: string, rawUrl: string) => {
    const url = normalizeUrl(rawUrl);
    if (!url) return;

    setBrowserTabs(prev => prev.map(tab => {
      if (tab.id !== id) return tab;
      const history = tab.history ?? [];
      const currentIndex = tab.historyIndex ?? history.length - 1;
      const nextHistory = [...history.slice(0, currentIndex + 1), url];
      return {
        ...tab,
        mode: "web",
        url,
        label: makeWebLabel(url),
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        reloadKey: (tab.reloadKey ?? 0) + 1,
      };
    }));
  }, []);

  const moveBrowserHistory = useCallback((id: string, delta: number) => {
    setBrowserTabs(prev => prev.map(tab => {
      if (tab.id !== id || tab.mode !== "web") return tab;
      const history = tab.history ?? [];
      const nextIndex = Math.max(0, Math.min(history.length - 1, (tab.historyIndex ?? -1) + delta));
      const url = history[nextIndex] ?? "";
      return {
        ...tab,
        url,
        label: makeWebLabel(url),
        historyIndex: nextIndex,
        reloadKey: (tab.reloadKey ?? 0) + 1,
      };
    }));
  }, []);

  const reloadBrowserTab = useCallback((id: string) => {
    setBrowserTabs(prev => prev.map(tab =>
      tab.id === id ? { ...tab, reloadKey: (tab.reloadKey ?? 0) + 1 } : tab
    ));
  }, []);

  const setBrowserZoom = useCallback((id: string, zoom: number) => {
    setBrowserTabs(prev => prev.map(tab =>
      tab.id === id ? { ...tab, zoom: Math.max(0.5, Math.min(2, zoom)) } : tab
    ));
  }, []);

  const toggleDeviceToolbar = useCallback((id: string) => {
    setBrowserTabs(prev => prev.map(tab =>
      tab.id === id ? { ...tab, deviceToolbar: !tab.deviceToolbar } : tab
    ));
  }, []);

  const clearBrowsingData = useCallback(async () => {
    try {
      localStorage.removeItem("studio.browser.history");
      sessionStorage.clear();
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
    } catch {
      // Browser storage clearing is best-effort in web mode.
    }
  }, []);

  const browserPanelContextValue = useMemo(() => ({
    openHtml: (html: string) => {
      const num = ++browserTabSeq.current;
      const id = `browser-${num}`;
      const label = num === 1 ? "preview" : `preview ${num}`;
      setBrowserTabs(prev => [...prev, {
        id,
        html,
        label,
        mode: "html",
        reloadKey: 0,
        zoom: 1,
        deviceToolbar: false,
      }]);
      setActiveBrowserTabId(id);
      setBrowserPanelOpen(true);
    },
  }), []);

  const handleTabClose = useCallback((id: string) => {
    setBrowserTabs(prev => {
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        setActiveBrowserTabId("");
        setBrowserPanelOpen(false);
        return [];
      }
      setActiveBrowserTabId(cur => cur === id ? next[Math.max(0, idx - 1)].id : cur);
      return next;
    });
  }, []);

  return {
    browserPanelOpen,
    setBrowserPanelOpen,
    browserTabs,
    activeBrowserTabId,
    setActiveBrowserTabId,
    browserPanelWidth,
    setBrowserPanelWidth,
    browserPanelContextValue,
    handleTabClose,
    createBrowserTab,
    ensureBrowserTab,
    navigateBrowserTab,
    moveBrowserHistory,
    reloadBrowserTab,
    setBrowserZoom,
    toggleDeviceToolbar,
    clearBrowsingData,
  };
}
