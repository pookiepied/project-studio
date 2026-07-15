import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { setRightPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { ArtifactPanel } from "@/features/artifacts";
import { BrowserPanel } from "../browser/BrowserPanel";
import type { BrowserTab } from "../browser/types";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { ArtifactTab } from "@/app/hooks/useArtifactPanel";
import { ResizeHandle } from "./ResizeHandle";
import { FilesPanel } from "./FilesPanel";
import { ReviewPanel } from "./ReviewPanel";
import { SideChatPanel } from "./SideChatPanel";
import type {
  BrowserWorkspaceState,
  FilesWorkspaceState,
  ProjectContextLike,
  ReviewWorkspaceState,
  SideChatWorkspaceState,
  TerminalWorkspaceState,
  WorkspaceTab,
  WorkspaceTabCreateOptions,
  WorkspaceTabState,
  WorkspaceTabType,
} from "./types";
import { WorkspaceHeader, WorkspaceLauncher } from "./RightWorkspaceChrome";

interface RightWorkspacePanelProps {
  open: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onClose: () => void;
  onCloseTab: (id: string) => void;
  onActivateTab: (id: string) => void;
  onCreateTab: (type: WorkspaceTabType, options?: WorkspaceTabCreateOptions) => string;
  onUpdateTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  projectContext?: ProjectContextLike | null;
  onTerminalWidthChange: (width: number) => void;
  browserTabs: BrowserTab[];
  onBrowserTabChange: (id: string) => void;
  onBrowserNavigate: (id: string, url: string) => void;
  onBrowserHistory: (id: string, delta: number) => void;
  onBrowserReload: (id: string) => void;
  onBrowserZoom: (id: string, zoom: number) => void;
  onBrowserToggleDeviceToolbar: (id: string) => void;
  onBrowserClearData: () => void;
  onBrowserWidthChange: (width: number) => void;
  artifactTabs: ArtifactTab[];
  activeArtifactTabId: string;
  onArtifactTabChange: (id: string) => void;
  onArtifactTabClose: (id: string) => void;
  onArtifactWidthChange: (width: number) => void;
}

export function RightWorkspacePanel({
  open,
  tabs,
  activeTabId,
  onClose,
  onCloseTab,
  onActivateTab,
  onCreateTab,
  onUpdateTab,
  projectContext,
  onTerminalWidthChange,
  browserTabs,
  onBrowserTabChange,
  onBrowserNavigate,
  onBrowserHistory,
  onBrowserReload,
  onBrowserZoom,
  onBrowserToggleDeviceToolbar,
  onBrowserClearData,
  onBrowserWidthChange,
  artifactTabs,
  activeArtifactTabId,
  onArtifactTabChange,
  onArtifactTabClose,
  onArtifactWidthChange,
}: RightWorkspacePanelProps) {
  const reduceMotion = useReducedMotion();
  const [workspaceWidth, setWorkspaceWidth] = useState(() => {
    const available = Math.max(320, window.innerWidth - 380);
    const preferred = Math.round(window.innerWidth * 0.4);
    return Math.min(available, Math.max(Math.min(480, available), preferred));
  });
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;

  useEffect(() => {
    setRightPanelWidth(open ? workspaceWidth : 0);
  }, [open, workspaceWidth]);
  useEffect(() => () => setRightPanelWidth(0), []);
  useEffect(() => {
    const clampWidth = () => setWorkspaceWidth((current) => {
      const max = Math.max(320, window.innerWidth - 360);
      return Math.min(current, max);
    });
    window.addEventListener("resize", clampWidth);
    return () => window.removeEventListener("resize", clampWidth);
  }, []);

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = workspaceWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (event: MouseEvent) => {
      const maxW = Math.max(320, window.innerWidth - 360);
      const minW = Math.min(maxW, Math.max(320, Math.round(window.innerWidth * 0.24)));
      setWorkspaceWidth(Math.max(minW, Math.min(maxW, startW + (startX - event.clientX))));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const create = (type: WorkspaceTabType) => {
    onCreateTab(type, {
      rootPath: projectContext?.path ?? null,
      cwd: projectContext?.path ?? null,
    });
  };

  const renderTab = (tab: WorkspaceTab) => {
    if (tab.type === "review") {
      const state = tab.state as ReviewWorkspaceState;
      return (
        <ReviewPanel
          rootPath={state.rootPath ?? projectContext?.path ?? null}
          selectedPath={state.selectedPath}
          onStateChange={(next) => onUpdateTab(tab.id, {
            state: {
              ...state,
              ...next,
            } as WorkspaceTabState,
          })}
          onOpenFiles={() => create("files")}
        />
      );
    }

    if (tab.type === "browser") {
      const state = tab.state as BrowserWorkspaceState;
      const browserTab = browserTabs.find((item) => item.id === state.browserTabId);
      return (
        <BrowserPanel
          tabs={browserTab ? [browserTab] : []}
          activeTabId={state.browserTabId}
          onTabChange={onBrowserTabChange}
          onTabClose={() => onCloseTab(tab.id)}
          onNewTab={() => create("browser")}
          onNavigate={onBrowserNavigate}
          onHistory={onBrowserHistory}
          onReload={onBrowserReload}
          onZoom={onBrowserZoom}
          onToggleDeviceToolbar={onBrowserToggleDeviceToolbar}
          onClearBrowsingData={onBrowserClearData}
          onOpenWorkspaceView={(view) => create(view)}
          visible={activeTab?.id === tab.id}
          width={workspaceWidth}
          onWidthChange={(width) => {
            setWorkspaceWidth(width);
            onBrowserWidthChange(width);
          }}
          onClose={() => onCloseTab(tab.id)}
          showChrome={false}
          showResizeHandle={false}
        />
      );
    }

    if (tab.type === "terminal") {
      const state = tab.state as TerminalWorkspaceState;
      return (
        <TerminalPanel
          width={workspaceWidth}
          onWidthChange={(width) => {
            setWorkspaceWidth(width);
            onTerminalWidthChange(width);
          }}
          onClose={() => onCloseTab(tab.id)}
          projectCwd={state.cwd ?? projectContext?.path ?? null}
          showChrome={false}
          showResizeHandle={false}
        />
      );
    }

    if (tab.type === "files") {
      const state = tab.state as FilesWorkspaceState;
      return (
        <FilesPanel
          rootPath={state.rootPath ?? projectContext?.path ?? null}
          selectedPath={state.selectedPath}
          expandedPaths={state.expandedPaths}
          onStateChange={(next) => onUpdateTab(tab.id, {
            state: {
              ...state,
              ...next,
            } as WorkspaceTabState,
          })}
        />
      );
    }

    if (tab.type === "side-chat") {
      const state = tab.state as SideChatWorkspaceState;
      return (
        <SideChatPanel
          initialConversationId={state.conversationId}
          onConversationChange={(conversationId, title) => {
            onUpdateTab(tab.id, {
              title: title ?? tab.title,
              state: { conversationId } as WorkspaceTabState,
            });
          }}
        />
      );
    }

    return (
      <ArtifactPanel
        tabs={artifactTabs}
        activeTabId={activeArtifactTabId}
        width={workspaceWidth}
        onTabChange={onArtifactTabChange}
        onTabClose={onArtifactTabClose}
        onWidthChange={(width) => {
          setWorkspaceWidth(width);
          onArtifactWidthChange(width);
        }}
        onClose={() => onCloseTab(tab.id)}
      />
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="right-workspace"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: workspaceWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{
            width: { duration: reduceMotion ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] },
            opacity: { duration: reduceMotion ? 0 : 0.16, ease: "easeOut" },
          }}
          className="h-full flex-shrink-0 overflow-hidden"
        >
          <div className="flex h-full transition-colors duration-300" style={{ width: workspaceWidth, minWidth: workspaceWidth }}>
            <ResizeHandle onMouseDown={onResizeDown} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-2xl rounded-bl-2xl border-l border-surface-border bg-surface-page shadow-xl">
              <WorkspaceHeader
                tabs={tabs}
                activeTabId={activeTabId}
                onActivateTab={onActivateTab}
                onCloseTab={onCloseTab}
                onCreateTab={create}
                onClose={onClose}
              />
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {tabs.length > 0 ? tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`absolute inset-0 min-h-0 min-w-0 overflow-hidden ${activeTab?.id === tab.id ? "visible" : "invisible pointer-events-none"}`}
                    aria-hidden={activeTab?.id !== tab.id}
                  >
                    {renderTab(tab)}
                  </div>
                )) : <WorkspaceLauncher onCreateTab={create} />}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
