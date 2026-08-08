import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { setRightPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { ArtifactPanel } from "@/features/artifacts";
import type { ActiveToolCall, TaskItem } from "@/types/tools";
import type { ChatMessage, MessageSegment } from "@/types";
import { BrowserPanel } from "../browser/BrowserPanel";
import type { BrowserTab } from "../browser/types";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { ArtifactTab } from "@/app/hooks/useArtifactPanel";
import { ResizeHandle } from "./ResizeHandle";
import { FilesPanel } from "./FilesPanel";
import { ReviewPanel } from "./ReviewPanel";
import { SideChatPanel } from "./SideChatPanel";
import {
  WORKSPACE_PANEL_DEFAULT_WIDTH,
  clampWorkspacePanelWidth,
} from "./workspacePanelGeometry";
import { ConversationWorkspacePanel } from "./ConversationWorkspacePanel";
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
  messages: ChatMessage[];
  activeToolCalls: ActiveToolCall[];
  sessionTasks: TaskItem[];
  pendingMessages: unknown[];
  harnessSegments: MessageSegment[];
  contextTokens: number;
  contextLimit: number;
  usageContextTokens: number;
  isLoading: boolean;
  isStreaming: boolean;
  isSummarizing: boolean;
  projectName?: string | null;
  conversationTitle?: string | null;
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
  messages,
  activeToolCalls,
  sessionTasks,
  pendingMessages,
  harnessSegments,
  contextTokens,
  contextLimit,
  usageContextTokens,
  isLoading,
  isStreaming,
  isSummarizing,
  projectName,
  conversationTitle,
}: RightWorkspacePanelProps) {
  const reduceMotion = useReducedMotion();
  const [workspaceWidth, setWorkspaceWidth] = useState(() => clampWorkspacePanelWidth(WORKSPACE_PANEL_DEFAULT_WIDTH));
  const [classicWorkspaceVisible, setClassicWorkspaceVisible] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;

  useEffect(() => {
    setRightPanelWidth(open ? workspaceWidth : 0);
  }, [open, workspaceWidth]);
  useEffect(() => () => setRightPanelWidth(0), []);
  useEffect(() => {
    const clampWidth = () => setWorkspaceWidth((current) => {
      return clampWorkspacePanelWidth(current);
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
      setWorkspaceWidth(clampWorkspacePanelWidth(startW + (startX - event.clientX)));
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

  const launchClassicWorkspace = (type: WorkspaceTabType) => {
    setClassicWorkspaceVisible(true);
    create(type);
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
            const nextWidth = clampWorkspacePanelWidth(width);
            setWorkspaceWidth(nextWidth);
            onBrowserWidthChange(nextWidth);
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
            const nextWidth = clampWorkspacePanelWidth(width);
            setWorkspaceWidth(nextWidth);
            onTerminalWidthChange(nextWidth);
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
          const nextWidth = clampWorkspacePanelWidth(width);
          setWorkspaceWidth(nextWidth);
          onArtifactWidthChange(nextWidth);
        }}
        onClose={() => onCloseTab(tab.id)}
      />
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          layout
          key="right-workspace"
          initial={{ width: 0 }}
          animate={{ width: workspaceWidth }}
          exit={{ width: 0 }}
          transition={{
            width: { duration: reduceMotion ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] },
            layout: { duration: reduceMotion ? 0 : 0.28, ease: [0.32, 0.72, 0, 1] },
          }}
          className="h-full flex-shrink-0 overflow-hidden"
        >
          <div className="flex h-full transition-colors duration-300" style={{ width: workspaceWidth, minWidth: workspaceWidth }}>
            <ResizeHandle onMouseDown={onResizeDown} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-page shadow-none">
              {classicWorkspaceVisible ? (
                <>
                  <WorkspaceHeader
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onActivateTab={onActivateTab}
                    onCloseTab={onCloseTab}
                    onCreateTab={create}
                    onClose={() => setClassicWorkspaceVisible(false)}
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
                </>
              ) : (
                <ConversationWorkspacePanel
                  messages={messages}
                  activeToolCalls={activeToolCalls}
                  sessionTasks={sessionTasks}
                  pendingMessages={pendingMessages}
                  harnessSegments={harnessSegments}
                  contextTokens={contextTokens}
                  contextLimit={contextLimit}
                  usageContextTokens={usageContextTokens}
                  isLoading={isLoading}
                  isStreaming={isStreaming}
                  isSummarizing={isSummarizing}
                  projectName={projectName}
                  conversationTitle={conversationTitle}
                  tabsOpen={tabs.length}
                  onLaunch={launchClassicWorkspace}
                  onClose={onClose}
                />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
