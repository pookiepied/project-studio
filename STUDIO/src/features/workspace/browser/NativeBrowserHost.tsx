import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { nativeBrowserService, type NativeBrowserBounds } from "./nativeBrowserService";
import type { BrowserTab } from "./types";

function readBounds(element: HTMLElement): NativeBrowserBounds | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function NativeBrowserHost({
  activeTab,
  tabs,
  occluded,
}: {
  activeTab: BrowserTab;
  tabs: BrowserTab[];
  occluded: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const createdTabs = useRef(new Set<string>());
  const previousTabIds = useRef(new Set<string>());

  const webTabIds = useMemo(
    () => new Set(tabs.filter((tab) => tab.mode === "web").map((tab) => tab.id)),
    [tabs]
  );

  useEffect(() => {
    const previous = previousTabIds.current;
    previous.forEach((tabId) => {
      if (!webTabIds.has(tabId)) {
        nativeBrowserService.close(tabId).catch(() => {});
        createdTabs.current.delete(tabId);
      }
    });
    previousTabIds.current = webTabIds;
  }, [webTabIds]);

  useEffect(() => {
    tabs.forEach((tab) => {
      if (tab.mode === "web" && tab.id !== activeTab.id) {
        nativeBrowserService.hide(tab.id).catch(() => {});
      }
    });
  }, [activeTab.id, tabs]);

  useLayoutEffect(() => {
    const element = hostRef.current;
    if (!element || activeTab.mode !== "web" || !activeTab.url) return;

    let frame = 0;
    let disposed = false;

    const sync = () => {
      if (disposed) return;
      if (occluded) {
        nativeBrowserService.hide(activeTab.id).catch(() => {});
        return;
      }

      const bounds = readBounds(element);
      if (!bounds) return;

      const hasCreated = createdTabs.current.has(activeTab.id);
      const action = hasCreated
        ? nativeBrowserService.setBounds(activeTab.id, bounds).then(() => nativeBrowserService.show(activeTab.id))
        : nativeBrowserService.create(activeTab.id, activeTab.url ?? "", bounds).then(() => {
            createdTabs.current.add(activeTab.id);
          });

      action.catch(() => {});
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(element);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);

    scheduleSync();
    const settleFrame = requestAnimationFrame(scheduleSync);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      nativeBrowserService.hide(activeTab.id).catch(() => {});
    };
  }, [activeTab.id, activeTab.mode, activeTab.url, occluded]);

  useEffect(() => {
    if (activeTab.mode === "web" && activeTab.url && createdTabs.current.has(activeTab.id)) {
      nativeBrowserService.navigate(activeTab.id, activeTab.url).catch(() => {});
    }
  }, [activeTab.id, activeTab.mode, activeTab.url, activeTab.reloadKey]);

  useEffect(() => {
    if (activeTab.mode === "web" && createdTabs.current.has(activeTab.id)) {
      nativeBrowserService.setZoom(activeTab.id, activeTab.zoom ?? 1).catch(() => {});
    }
  }, [activeTab.id, activeTab.mode, activeTab.zoom]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full bg-surface-page"
      aria-label={activeTab.label}
    />
  );
}
