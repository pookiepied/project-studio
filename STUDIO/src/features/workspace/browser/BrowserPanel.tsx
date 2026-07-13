import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Add,
  Back,
  Close,
  Conversation,
  DotsThreeVerticalIcon,
  Files,
  Forward,
  Globe,
  Icon,
  Redo,
  Remove,
  Search,
  Terminal,
} from "@/ui/icons";
import { FONT_SANS } from "@/design/fonts";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Input } from "@/ui/primitives/Input";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";
import type { RightWorkspaceView } from "../rightWorkspace/types";
import { NativeBrowserHost } from "./NativeBrowserHost";
import { nativeBrowserService } from "./nativeBrowserService";

export interface BrowserTab {
  id: string;
  label: string;
  mode: "html" | "web";
  html?: string;
  url?: string;
  history?: string[];
  historyIndex?: number;
  reloadKey?: number;
  zoom?: number;
  deviceToolbar?: boolean;
}

interface BrowserPanelProps {
  tabs: BrowserTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
  onNavigate: (id: string, url: string) => void;
  onHistory: (id: string, delta: number) => void;
  onReload: (id: string) => void;
  onZoom: (id: string, zoom: number) => void;
  onToggleDeviceToolbar: (id: string) => void;
  onClearBrowsingData: () => void;
  onOpenWorkspaceView: (view: RightWorkspaceView) => void;
  visible?: boolean;
  width: number;
  onWidthChange: (w: number) => void;
  onClose: () => void;
  showChrome?: boolean;
  showResizeHandle?: boolean;
}

const makeSrcDoc = (html: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: ${FONT_SANS}; font-size: 14px; line-height: 1.6; }
</style>
</head>
<body>${html}</body>
</html>`;

function getIframeSrc(tab: BrowserTab) {
  if (tab.mode === "html") return undefined;
  return tab.url || undefined;
}

function BrowserMenu({
  activeTab,
  onClose,
  onReload,
  onZoom,
  onToggleDeviceToolbar,
  onClearBrowsingData,
  onNewTab,
}: {
  activeTab?: BrowserTab;
  onClose: () => void;
  onReload: () => void;
  onZoom: (zoom: number) => void;
  onToggleDeviceToolbar: () => void;
  onClearBrowsingData: () => void;
  onNewTab: () => void;
}) {
  const zoom = activeTab?.zoom ?? 1;
  const canUsePageTools = !!activeTab && (activeTab.mode === "html" || !!activeTab.url);

  return (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-surface-border dark:bg-surface-raised">
      <Button
        variant="ghost"
        onClick={() => { onNewTab(); onClose(); }}
        className="w-full justify-start gap-2 px-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-surface-selected"
      >
        New tab
      </Button>
      <div className="my-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
      <Button
        variant="ghost"
        onClick={() => { onReload(); onClose(); }}
        disabled={!canUsePageTools}
        className="w-full justify-start gap-2 px-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-surface-selected"
      >
        Force reload
      </Button>
      <Button
        variant="ghost"
        disabled={!canUsePageTools}
        className="w-full justify-start gap-2 px-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-surface-selected"
      >
        Find in page
      </Button>
      <div className="my-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
      <div className="flex h-8 items-center gap-2 px-2.5 text-sm text-gray-700 dark:text-gray-300">
        <span className="min-w-0 flex-1">Zoom</span>
        <IconButton
          aria-label="Zoom out"
          variant="ghost"
          onClick={() => onZoom(zoom - 0.1)}
          disabled={!canUsePageTools}
          className="h-6 w-6 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-surface-selected"
        >
          <Remove size="xs" />
        </IconButton>
        <span className="w-9 text-center text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
        <IconButton
          aria-label="Zoom in"
          variant="ghost"
          onClick={() => onZoom(zoom + 0.1)}
          disabled={!canUsePageTools}
          className="h-6 w-6 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-surface-selected"
        >
          <Add size="xs" />
        </IconButton>
      </div>
      <Button
        variant="ghost"
        onClick={() => { onToggleDeviceToolbar(); onClose(); }}
        disabled={!canUsePageTools}
        className="w-full justify-start gap-2 px-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-surface-selected"
      >
        Show device toolbar
      </Button>
      <div className="my-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
      <Button
        variant="ghost"
        onClick={() => { onClearBrowsingData(); onClose(); }}
        className="w-full justify-start gap-2 px-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-surface-selected"
      >
        Clear cookies and cache
      </Button>
    </div>
  );
}

function SidePanelMenu({
  onOpenWorkspaceView,
  onClose,
}: {
  onOpenWorkspaceView: (view: RightWorkspaceView) => void;
  onClose: () => void;
}) {
  const items: Array<{ view: RightWorkspaceView; label: string; SidePanelIcon: typeof Globe }> = [
    { view: "browser", label: "Browser", SidePanelIcon: Globe },
    { view: "terminal", label: "Terminal", SidePanelIcon: Terminal },
    { view: "files", label: "Files", SidePanelIcon: Files },
    { view: "side-chat", label: "Side chat", SidePanelIcon: Conversation },
  ];

  return (
    <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-surface-border dark:bg-surface-raised">
      {items.map(({ view, label, SidePanelIcon }) => (
        <Button
          key={view}
          variant="ghost"
          onClick={() => { onOpenWorkspaceView(view); onClose(); }}
          className="w-full justify-start gap-2 px-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-surface-selected"
        >
          <SidePanelIcon size="sm" className="text-gray-500" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Button>
      ))}
    </div>
  );
}

export function BrowserPanel({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onNewTab,
  onNavigate,
  onHistory,
  onReload,
  onZoom,
  onToggleDeviceToolbar,
  onClearBrowsingData,
  onOpenWorkspaceView,
  visible = true,
  width,
  onWidthChange,
  onClose,
  showChrome = true,
  showResizeHandle = true,
}: BrowserPanelProps) {
  const [addressValue, setAddressValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sideMenuRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sw: number } | null>(null);
  useOnClickOutside(menuRef, () => setMenuOpen(false), menuOpen);
  useOnClickOutside(sideMenuRef, () => setSideMenuOpen(false), sideMenuOpen);

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  );

  useEffect(() => {
    setAddressValue(activeTab?.mode === "web" ? activeTab.url ?? "" : "");
  }, [activeTab?.id, activeTab?.mode, activeTab?.url]);

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sw: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Cap at half the window so the chat side always keeps >=50% (rail + text
      // get crushed otherwise); never exceed 1000 or drop below 400.
      const maxW = Math.max(400, Math.min(1000, Math.round(window.innerWidth * 0.5)));
      onWidthChange(Math.max(400, Math.min(maxW,
        drag.current.sw + (drag.current.sx - ev.clientX)
      )));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const history = activeTab?.history ?? [];
  const historyIndex = activeTab?.historyIndex ?? -1;
  const canGoBack = activeTab?.mode === "web" && historyIndex > 0;
  const canGoForward = activeTab?.mode === "web" && historyIndex >= 0 && historyIndex < history.length - 1;
  const canReload = !!activeTab && (activeTab.mode === "html" || !!activeTab.url);
  const canUseNativeBrowser = nativeBrowserService.isAvailable();

  const submitAddress = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTab) {
      onNewTab();
      return;
    }
    onNavigate(activeTab.id, addressValue);
  };

  const handleHistory = (delta: number) => {
    if (!activeTab) return;
    onHistory(activeTab.id, delta);
    if (canUseNativeBrowser && activeTab.mode === "web") {
      const action = delta < 0 ? nativeBrowserService.back : nativeBrowserService.forward;
      action(activeTab.id).catch(() => {});
    }
  };

  const handleReload = () => {
    if (!activeTab) return;
    onReload(activeTab.id);
    if (canUseNativeBrowser && activeTab.mode === "web") {
      nativeBrowserService.reload(activeTab.id).catch(() => {});
    }
  };

  const handleClearBrowsingData = () => {
    onClearBrowsingData();
    if (canUseNativeBrowser && activeTab?.mode === "web") {
      nativeBrowserService.clearData(activeTab.id).catch(() => {});
    }
  };

  return (
    <div className="flex h-full transition-colors duration-300" style={{ width, minWidth: width }}>
      {showResizeHandle && <ResizeHandle onMouseDown={onResizeDown} />}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-surface-page">
        {showChrome && (
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 transition-colors duration-300 dark:border-white/[0.06] dark:bg-surface-page">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <div className="flex min-w-0 items-center gap-1">
              {tabs.map(tab => {
                const active = tab.id === activeTab?.id;
                return (
                  <Button
                    key={tab.id}
                    variant="ghost"
                    onClick={() => onTabChange(tab.id)}
                    className={`group/tab h-7 min-w-0 max-w-[120px] items-center justify-start gap-1.5 rounded-lg px-2 text-sm transition-colors ${
                      active
                        ? "bg-gray-100 text-gray-800 dark:bg-surface-raised dark:text-gray-200"
                        : "text-gray-500 hover:bg-gray-50 dark:text-gray-500 dark:hover:bg-surface-raised"
                    }`}
                  >
                    <Globe size="sm" className="flex-shrink-0" />
                    <span className="truncate">{tab.label}</span>
                    <span
                      role="button"
                      onClick={(ev) => { ev.stopPropagation(); onTabClose(tab.id); }}
                      className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-gray-200 dark:hover:bg-surface-border"
                    >
                      <Close size="xs" />
                    </span>
                  </Button>
                );
              })}
            </div>

            <div className="relative flex-shrink-0" ref={sideMenuRef}>
              <IconButton
                aria-label="Open side panel"
                variant="ghost"
                size="sm"
                onClick={() => setSideMenuOpen((v) => !v)}
                className="text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
              >
                <Add size="sm" />
              </IconButton>
              {sideMenuOpen && (
                <SidePanelMenu
                  onOpenWorkspaceView={onOpenWorkspaceView}
                  onClose={() => setSideMenuOpen(false)}
                />
              )}
            </div>
          </div>

          <IconButton
            aria-label="Close browser"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="flex-shrink-0 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-300"
          >
            <Close size="sm" />
          </IconButton>
        </div>
        )}

        <div className="flex h-9 flex-shrink-0 items-center gap-1.5 border-b border-gray-100 bg-white px-3 transition-colors duration-300 dark:border-white/[0.06] dark:bg-surface-page">
          <IconButton
            aria-label="Back"
            variant="ghost"
            size="sm"
            onClick={() => handleHistory(-1)}
            disabled={!canGoBack}
            className="text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-35 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
          >
            <Back size="sm" />
          </IconButton>
          <IconButton
            aria-label="Forward"
            variant="ghost"
            size="sm"
            onClick={() => handleHistory(1)}
            disabled={!canGoForward}
            className="text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-35 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
          >
            <Forward size="sm" />
          </IconButton>
          <IconButton
            aria-label="Reload"
            variant="ghost"
            size="sm"
            onClick={handleReload}
            disabled={!canReload}
            className="text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-35 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
          >
            <Redo size="sm" />
          </IconButton>

          <form onSubmit={submitAddress} className="relative mx-auto min-w-[180px] flex-[0_1_420px]">
            <Search size="sm" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600" />
            <Input
              size="sm"
              value={addressValue}
              onChange={(event) => setAddressValue(event.target.value)}
              placeholder="Enter a URL"
              className="border-0 bg-transparent px-8 text-center outline-none focus:bg-surface-hover focus:text-left focus-visible:ring-transparent dark:focus:bg-surface-raised"
            />
          </form>

          <div className="relative flex-shrink-0" ref={menuRef}>
            <IconButton
              aria-label="Browser options"
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen((v) => !v)}
              className="text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400"
            >
              <Icon icon={DotsThreeVerticalIcon} size="md" />
            </IconButton>
            {menuOpen && (
              <BrowserMenu
                activeTab={activeTab}
                onClose={() => setMenuOpen(false)}
                onReload={handleReload}
                onZoom={(zoom) => activeTab && onZoom(activeTab.id, zoom)}
                onToggleDeviceToolbar={() => activeTab && onToggleDeviceToolbar(activeTab.id)}
                onClearBrowsingData={handleClearBrowsingData}
                onNewTab={onNewTab}
              />
            )}
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden bg-surface-page">
          {!activeTab || (activeTab.mode === "web" && !activeTab.url) ? (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div>
                <Globe size="xl" className="mx-auto mb-6 text-gray-400 dark:text-gray-600" />
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Start browsing</p>
                <p className="mt-3 text-sm text-gray-400 dark:text-gray-600">Enter a URL to open a page</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-stretch justify-center overflow-hidden bg-surface-page">
              <div
                className={`h-full min-w-0 overflow-hidden transition-all ${
                  activeTab.deviceToolbar ? "my-4 max-w-[390px] rounded-xl border border-gray-200 shadow-sm dark:border-white/[0.08]" : "w-full"
                }`}
                style={{ width: activeTab.deviceToolbar ? "390px" : "100%" }}
              >
                {canUseNativeBrowser && activeTab.mode === "web" ? (
                  <NativeBrowserHost
                    activeTab={activeTab}
                    tabs={tabs}
                    occluded={!visible || menuOpen || sideMenuOpen}
                  />
                ) : (
                  <iframe
                    key={`${activeTab.id}-${activeTab.reloadKey ?? 0}`}
                    src={getIframeSrc(activeTab)}
                    srcDoc={activeTab.mode === "html" ? makeSrcDoc(activeTab.html ?? "") : undefined}
                    sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
                    title={activeTab.label}
                    className="h-full w-full border-0 bg-surface-page"
                    style={{ zoom: activeTab.zoom ?? 1 }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
