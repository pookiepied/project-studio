import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";
import {
  Icon,
  Add,
  Close,
  Collapse,
  Conversation,
  Files,
  GitBranchIcon,
  CaretLeftIcon,
  Globe,
  List,
  Terminal,
} from "@/ui/icons";
import { setRightPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
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

// GitBranch has no barrel concept yet — wrap the raw glyph via the `<Icon>`
// escape-hatch so it obeys the same size scale + resting weight as concepts.
const GitBranch = forwardRef<SVGSVGElement, ComponentPropsWithoutRef<typeof Close>>(
  (props, ref) => <Icon ref={ref} icon={GitBranchIcon} {...props} />,
);
GitBranch.displayName = "GitBranch";

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
  { type: "review", label: "Review", description: "Git changes, diffs, and branches", Icon: GitBranch },
  { type: "browser", label: "Browser", description: "Web pages and live previews", Icon: Globe },
  { type: "terminal", label: "Terminal", description: "Run a shell in your project", Icon: Terminal },
  { type: "files", label: "Files", description: "Browse and open project files", Icon: Files },
  { type: "side-chat", label: "Side chat", description: "A second conversation alongside chat", Icon: Conversation },
];

function iconFor(type: WorkspaceTabType) {
  if (type === "review") return GitBranch;
  if (type === "terminal") return Terminal;
  if (type === "files") return Files;
  if (type === "side-chat") return Conversation;
  return Globe;
}

function WorkspaceCreateMenu({
  onCreate,
  onDismiss,
  position,
}: {
  onCreate: (type: WorkspaceTabType) => void;
  onDismiss: () => void;
  position: { top: number; right: number };
}) {
  const [index, setIndex] = useState(0);
  const menuElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => menuElementRef.current?.focus(), []);

  return (
    <motion.div
      ref={menuElementRef}
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
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
      }}
      tabIndex={-1}
      role="menu"
      style={{ top: position.top, right: position.right }}
      className="fixed z-popover w-64 overflow-hidden rounded-xl border border-surface-border/80 bg-surface-base p-1.5 shadow-xl"
    >
      {WORKSPACE_TYPES.map(({ type, label, description, Icon }, itemIndex) => (
        <Button
          key={type}
          variant="ghost"
          onMouseEnter={() => setIndex(itemIndex)}
          onClick={() => onCreate(type)}
          className={`flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-2 h-auto text-left transition-colors ${
            index === itemIndex ? "bg-surface-hover" : ""
          }`}
        >
          <Icon size="sm" className="flex-shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-primary">{label}</span>
            <span className="block truncate text-2xs text-muted">{description}</span>
          </span>
        </Button>
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
  const [tabListOpen, setTabListOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [tabListPosition, setTabListPosition] = useState({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const tabListButtonRef = useRef<HTMLButtonElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLElement>());
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));

  useEffect(() => {
    tabRefs.current.get(activeTabId ?? "")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    if (!menuOpen && !tabListOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!menuRef.current?.contains(target) && !target.closest('[role="menu"]')) {
        setMenuOpen(false);
        setTabListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, tabListOpen]);

  const moveTab = (delta: number) => {
    if (!tabs.length) return;
    const next = (activeIndex + delta + tabs.length) % tabs.length;
    onActivateTab(tabs[next].id);
  };

  return (
    <div className="flex h-10 flex-shrink-0 items-center border-b border-surface-divider bg-surface-page px-1.5">
      <IconButton aria-label="Previous tab" variant="ghost" size="sm" onClick={() => moveTab(-1)} disabled={tabs.length < 2} className="flex-shrink-0 text-muted disabled:opacity-25"><Icon icon={CaretLeftIcon} size="sm" /></IconButton>
      <IconButton aria-label="Next tab" variant="ghost" size="sm" onClick={() => moveTab(1)} disabled={tabs.length < 2} className="flex-shrink-0 text-muted disabled:opacity-25"><Collapse size="sm" /></IconButton>
      <div ref={tabStripRef} role="tablist" className="scrollbar-hide min-w-0 flex-1 overflow-x-auto overflow-y-hidden" onWheel={(event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
      }}>
        <motion.div layout className="flex min-w-max items-stretch">
          <AnimatePresence initial={false} mode="popLayout">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const Icon = iconFor(tab.type);
            return (
              <motion.div
                layout
                key={tab.id}
                ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }}
                initial={{ opacity: 0, scale: 0.94, x: 8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.92, width: 0, paddingLeft: 0, paddingRight: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`group/tab relative flex h-9 w-[160px] max-w-[220px] items-center gap-1.5 overflow-hidden border-r border-surface-divider px-2 text-xs transition-colors ${
                  active
                    ? "bg-surface-base text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                    : "text-secondary hover:bg-surface-hover hover:text-primary"
                }`}
              >
                <Button
                  variant="ghost"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onActivateTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") { event.preventDefault(); moveTab(-1); }
                    if (event.key === "ArrowRight") { event.preventDefault(); moveTab(1); }
                    if (event.key === "Home") { event.preventDefault(); onActivateTab(tabs[0].id); }
                    if (event.key === "End") { event.preventDefault(); onActivateTab(tabs[tabs.length - 1].id); }
                    if (event.key === "Delete") { event.preventDefault(); onCloseTab(tab.id); }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 justify-start px-0 py-0 h-auto w-full rounded-none text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus hover:bg-transparent"
                >
                  <Icon size="sm" className="flex-shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                </Button>
                <IconButton
                  aria-label={`Close ${tab.title}`}
                  variant="ghost"
                  onClick={() => onCloseTab(tab.id)}
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-opacity hover:bg-surface-border focus-visible:opacity-100 ${active ? "opacity-60" : "opacity-0 group-hover/tab:opacity-60"}`}
                >
                  <Close size="xs" />
                </IconButton>
              </motion.div>
            );
          })}
          </AnimatePresence>
        </motion.div>
      </div>
      <IconButton
        ref={tabListButtonRef}
        aria-label="All workspace tabs"
        variant="ghost"
        size="sm"
        onClick={() => {
          const rect = tabListButtonRef.current?.getBoundingClientRect();
          if (rect) setTabListPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
          setTabListOpen((value) => !value);
          setMenuOpen(false);
        }}
        className="flex-shrink-0 text-muted"
      ><List size="sm" /></IconButton>
      {createPortal(
        <AnimatePresence>
          {tabListOpen && (
            <motion.div role="menu" tabIndex={-1} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} style={{ top: tabListPosition.top, right: tabListPosition.right }} className="fixed z-popover max-h-72 w-64 overflow-y-auto rounded-lg border border-surface-border bg-surface-base p-1 shadow-xl scrollbar-auto-hide">
              {tabs.map((tab) => {
                const Icon = iconFor(tab.type);
                return <Button key={tab.id} variant="ghost" role="menuitem" onClick={() => { onActivateTab(tab.id); setTabListOpen(false); }} className={`flex h-8 w-full items-center justify-start gap-2 rounded-md px-2 text-left text-xs ${tab.id === activeTabId ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover"}`}><Icon size="sm" /><span className="min-w-0 flex-1 truncate">{tab.title}</span></Button>;
              })}
            </motion.div>
          )}
        </AnimatePresence>, document.body,
      )}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <IconButton
          ref={addButtonRef}
          aria-label="Create workspace panel"
          variant="ghost"
          onClick={() => {
            const rect = addButtonRef.current?.getBoundingClientRect();
            if (rect) setMenuPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
            setMenuOpen((value) => !value);
          }}
          className="text-muted"
        >
          <Add size="sm" />
        </IconButton>
        {createPortal(
          <AnimatePresence>
            {menuOpen && (
              <WorkspaceCreateMenu
                key="workspace-create-menu"
                position={menuPosition}
                onDismiss={() => setMenuOpen(false)}
                onCreate={(type) => {
                  onCreateTab(type);
                  setMenuOpen(false);
                }}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>
      <IconButton
        aria-label="Close workspace"
        variant="ghost"
        onClick={onClose}
        className="flex-shrink-0 text-muted"
      >
        <Close size="sm" />
      </IconButton>
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
                <Icon size="md" className="text-secondary" />
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
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-surface-border bg-surface-page">
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
