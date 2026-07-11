import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  ChatCircleTextIcon as ChatCircleText,
  FilesIcon as Files,
  GlobeIcon as Globe,
  PlusIcon as Plus,
  TerminalIcon as Terminal,
  XIcon as X,
} from "@phosphor-icons/react";
import { setRightPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { ArtifactPanel } from "@/features/artifacts";
import { BrowserPanel } from "../browser/BrowserPanel";
import type { BrowserTab } from "../browser/BrowserPanel";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { ArtifactTab } from "@/app/hooks/useArtifactPanel";
import { ResizeHandle } from "./ResizeHandle";
import { FilesPanel } from "./FilesPanel";
import { SideChatPanel } from "./SideChatPanel";
import type {
  BrowserWorkspaceState,
  FilesWorkspaceState,
  ProjectContextLike,
  SideChatWorkspaceState,
  TerminalWorkspaceState,
  WorkspaceTab,
  WorkspaceTabCreateOptions,
  WorkspaceTabState,
  WorkspaceTabType,
} from "./types";

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

const WORKSPACE_TYPES: Array<{ type: WorkspaceTabType; label: string; description: string; Icon: typeof Globe }> = [
  { type: "browser", label: "Browser", description: "Web pages and live previews", Icon: Globe },
  { type: "terminal", label: "Terminal", description: "Run a shell in your project", Icon: Terminal },
  { type: "files", label: "Files", description: "Browse and open project files", Icon: Files },
  { type: "side-chat", label: "Side chat", description: "A second conversation alongside chat", Icon: ChatCircleText },
];

function iconFor(type: WorkspaceTabType) {
  if (type === "terminal") return Terminal;
  if (type === "files") return Files;
  if (type === "side-chat") return ChatCircleText;
  return Globe;
}

function WorkspaceCreateMenu({
  onCreate,
}: {
  onCreate: (type: WorkspaceTabType) => void;
}) {
  const [index, setIndex] = useState(0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setIndex((value) => (value + 1) % WORKSPACE_TYPES.length);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setIndex((value) => (value - 1 + WORKSPACE_TYPES.length) % WORKSPACE_TYPES.length);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          onCreate(WORKSPACE_TYPES[index].type);
        }
      }}
      tabIndex={-1}
      className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
    >
      {WORKSPACE_TYPES.map(({ type, label, description, Icon }, itemIndex) => (
        <button
          key={type}
          type="button"
          onMouseEnter={() => setIndex(itemIndex)}
          onClick={() => onCreate(type)}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
            index === itemIndex ? "bg-surface-hover" : ""
          }`}
        >
          <Icon size={14} className="flex-shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-primary">{label}</span>
            <span className="block truncate text-2xs text-muted">{description}</span>
          </span>
        </button>
      ))}
    </motion.div>
  );
}

function WorkspaceHeader({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onCreateTab,
  onClose,
}: {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTab: (type: WorkspaceTabType) => void;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div className="flex h-[46px] flex-shrink-0 items-center gap-2 border-b border-surface-divider bg-surface-page px-3">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex min-w-max items-center gap-1">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const Icon = iconFor(tab.type);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onActivateTab(tab.id)}
                className={`group/tab flex h-8 max-w-[150px] items-center gap-1.5 rounded-lg px-2 text-xs transition-colors ${
                  active
                    ? "bg-surface-selected text-primary"
                    : "text-secondary hover:bg-surface-hover hover:text-primary"
                }`}
              >
                <Icon size={13} className="flex-shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                <span
                  role="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-border"
                >
                  <X size={9} weight="bold" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          title="Create workspace panel"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-primary"
        >
          <Plus size={14} weight="bold" />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <WorkspaceCreateMenu
              key="workspace-create-menu"
              onCreate={(type) => {
                onCreateTab(type);
                setMenuOpen(false);
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Close workspace"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-primary"
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

function WorkspaceLauncher({ onCreateTab }: { onCreateTab: (type: WorkspaceTabType) => void }) {
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[320px]"
      >
        <div className="mb-7 text-center">
          <p className="text-2xs font-medium uppercase tracking-extra-wide text-muted">Workspace</p>
          <h2 className="mt-2 font-display text-lg font-normal tracking-tight text-primary">Open a panel</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">Choose a panel to work alongside your conversation.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {WORKSPACE_TYPES.map(({ type, label, description, Icon }, index) => (
            // eslint-disable-next-line no-restricted-syntax -- vertical card launcher (icon-box + 2-line label column); Button primitive is row/label-oriented and doesn't model this layout. Same escape-hatch pattern as SearchInput's in-field control.
            <motion.button
              key={type}
              type="button"
              onClick={() => onCreateTab(type)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.26, delay: 0.06 + index * 0.05, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.98 }}
              className="group flex flex-col items-start gap-3 rounded-xl border border-surface-border bg-surface-base p-3.5 text-left transition-colors duration-fast hover:bg-surface-hover"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-divider bg-surface-raised">
                <Icon size={15} weight="regular" className="text-secondary" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-primary">{label}</span>
                <span className="mt-0.5 block text-2xs leading-relaxed text-muted">{description}</span>
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
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
  const [workspaceWidth, setWorkspaceWidth] = useState(440);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;

  useEffect(() => {
    setRightPanelWidth(open ? workspaceWidth : 0);
  }, [open, workspaceWidth]);
  useEffect(() => () => setRightPanelWidth(0), []);

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = workspaceWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (event: MouseEvent) => {
      const maxW = Math.max(380, Math.min(1080, Math.round(window.innerWidth * 0.55)));
      setWorkspaceWidth(Math.max(380, Math.min(maxW, startW + (startX - event.clientX))));
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
          initial={{ opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 48 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="h-full flex-shrink-0 overflow-hidden"
        >
          <div className="flex h-full transition-colors duration-300" style={{ width: workspaceWidth, minWidth: workspaceWidth }}>
            <ResizeHandle onMouseDown={onResizeDown} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-page">
              <WorkspaceHeader
                tabs={tabs}
                activeTabId={activeTabId}
                onActivateTab={onActivateTab}
                onCloseTab={onCloseTab}
                onCreateTab={create}
                onClose={onClose}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab ? renderTab(activeTab) : <WorkspaceLauncher onCreateTab={create} />}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
