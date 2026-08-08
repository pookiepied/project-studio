import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Close, FolderOpen, Terminal } from "@/ui/icons";
import { StudioIcon } from "@/ui/brand";
import { IconButton } from "@/ui/primitives/IconButton";
import { CLI_TOOLS } from "./cliTools";
import { STUDIO_TAB_ID, type ChatTab } from "./types";

export interface CliAvailability {
  available: boolean;
  version?: string;
}

interface ChatTabBarProps {
  tabs: ChatTab[];
  activeId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onMoveTab: (dragId: string, targetId: string, edge: "before" | "after") => void;
}

type DropTarget = { id: string; edge: "before" | "after" };

const EASE = [0.16, 1, 0.3, 1] as const;

export function ChatTabBar({ tabs, activeId, onSelectTab, onCloseTab, onMoveTab }: ChatTabBarProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [preview, setPreview] = useState<{ tab: ChatTab; rect: DOMRect } | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const switchTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
  }, []);

  const hasTaskTabs = tabs.length > 1;
  const beginPreview = (tab: ChatTab, element: HTMLElement) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    const rect = element.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => setPreview({ tab, rect }), 360);
  };
  const endPreview = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPreview(null);
  };
  const selectTab = (id: string) => {
    if (id === activeId) return;
    setSwitchingId(id);
    onSelectTab(id);
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => setSwitchingId(null), 180);
  };
  const moveByKeyboard = (tab: ChatTab, direction: -1 | 1) => {
    if (tab.id === STUDIO_TAB_ID) return;
    const reorderable = tabs.filter((item) => item.id !== STUDIO_TAB_ID);
    const index = reorderable.findIndex((item) => item.id === tab.id);
    const target = reorderable[index + direction];
    if (target) onMoveTab(tab.id, target.id, direction < 0 ? "before" : "after");
  };

  return (
    <>
      <div className="relative h-10 flex-shrink-0" aria-hidden={hasTaskTabs ? undefined : true}>
        <AnimatePresence initial={false}>
          {hasTaskTabs && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: EASE }}
              className="absolute inset-0 flex min-w-0 items-center border-t border-surface-divider bg-surface-page px-2"
              aria-label="Coding session tabs"
            >
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-hide" role="tablist">
                <AnimatePresence initial={false} mode="popLayout">
                  {tabs.map((tab) => (
                    <motion.div key={tab.id} layout className="flex items-center">
                      <TabButton
                        tab={tab}
                        active={tab.id === activeId}
                        switching={switchingId === tab.id}
                        dragging={draggingId === tab.id}
                        dropEdge={dropTarget?.id === tab.id ? dropTarget.edge : null}
                        onSelect={selectTab}
                        onClose={onCloseTab}
                        onMoveKeyboard={moveByKeyboard}
                        onPreviewStart={beginPreview}
                        onPreviewEnd={endPreview}
                        onDragStart={(event) => {
                          if (tab.id === STUDIO_TAB_ID) return;
                          endPreview();
                          setDraggingId(tab.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", tab.id);
                        }}
                        onDragOver={(event) => {
                          if (!draggingId || tab.id === STUDIO_TAB_ID) return;
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setDropTarget({ id: tab.id, edge: event.clientX < rect.left + rect.width / 2 ? "before" : "after" });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const dragId = event.dataTransfer.getData("text/plain") || draggingId;
                          if (dragId && dropTarget && tab.id !== STUDIO_TAB_ID) onMoveTab(dragId, tab.id, dropTarget.edge);
                          setDraggingId(null);
                          setDropTarget(null);
                        }}
                        onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {hasTaskTabs && preview && createPortal(
        <TabInfoCard tab={preview.tab} active={preview.tab.id === activeId} anchor={preview.rect} />,
        document.body,
      )}
    </>
  );
}

function TabButton({ tab, active, switching, dragging, dropEdge, onSelect, onClose, onMoveKeyboard, onPreviewStart, onPreviewEnd, ...dragHandlers }: {
  tab: ChatTab;
  active: boolean;
  switching: boolean;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMoveKeyboard: (tab: ChatTab, direction: -1 | 1) => void;
  onPreviewStart: (tab: ChatTab, element: HTMLElement) => void;
  onPreviewEnd: () => void;
  onDragStart: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  onDragEnd: React.DragEventHandler<HTMLDivElement>;
}) {
  const pinned = tab.id === STUDIO_TAB_ID;
  const Icon = tab.kind === "studio" ? StudioIcon : CLI_TOOLS.find((tool) => tool.id === tab.cliId)?.Icon;
  return (
    <div className="relative flex items-center">
      {dropEdge === "before" && <span className="absolute -left-px z-10 h-6 w-0.5 rounded-full bg-primary" />}
      <div
        draggable={!pinned}
        role="tab"
        tabIndex={0}
        aria-selected={active}
        aria-label={`${tab.title}${pinned ? ", pinned" : ""}`}
        onClick={() => onSelect(tab.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(tab.id); }
          if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); onMoveKeyboard(tab, -1); }
          if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); onMoveKeyboard(tab, 1); }
        }}
        onMouseEnter={(event) => onPreviewStart(tab, event.currentTarget)}
        onMouseLeave={onPreviewEnd}
        onFocus={(event) => onPreviewStart(tab, event.currentTarget)}
        onBlur={onPreviewEnd}
        className={`group/tab relative mx-0.5 flex h-8 min-w-[96px] max-w-[190px] cursor-default items-center gap-1.5 rounded-md px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${dragging ? "opacity-45" : "opacity-100"} ${active ? "bg-surface-selected font-medium text-primary" : "text-muted hover:bg-surface-hover hover:text-secondary"}`}
        title={pinned ? "Studio (pinned)" : `${tab.title}. Alt+Left or Alt+Right to reorder`}
        {...dragHandlers}
      >
        {Icon && <Icon size={14} className="flex-shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{tab.title}</span>
        {switching && <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-primary" aria-label="Switching" />}
        {tab.kind === "cli" && (
          <IconButton size="sm" aria-label={`Close ${tab.title}`} title="Close tab" onClick={(event) => { event.stopPropagation(); onClose(tab.id); }} className="h-4 w-4 rounded opacity-0 hover:bg-surface-border group-hover/tab:opacity-100 group-focus-within/tab:opacity-100">
            <Close size="xs" />
          </IconButton>
        )}
        {active && <motion.span layoutId="active-chat-tab" className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-primary" />}
      </div>
      {dropEdge === "after" && <span className="absolute -right-px z-10 h-6 w-0.5 rounded-full bg-primary" />}
    </div>
  );
}

function TabInfoCard({ tab, active, anchor }: { tab: ChatTab; active: boolean; anchor: DOMRect }) {
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 12));
  const bottom = Math.max(56, window.innerHeight - anchor.top + 8);
  const Icon = tab.kind === "studio" ? StudioIcon : CLI_TOOLS.find((tool) => tool.id === tab.cliId)?.Icon;
  const pathParts = tab.cwd?.split(/[\\/]/).filter(Boolean) || [];
  const projectName = pathParts[pathParts.length - 1];
  return (
    <motion.div initial={{ opacity: 0, y: 5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.12, ease: EASE }} style={{ position: "fixed", left, bottom, width, zIndex: 9998 }} className="pointer-events-none rounded-lg border border-surface-border bg-surface-page p-3 shadow-xl dark:bg-surface-raised" role="tooltip">
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={16} /> : <Terminal size="sm" />}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">{tab.title}</span>
        <span className="flex items-center gap-1 text-2xs text-muted"><span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-success" : "bg-text-muted"}`} />{active ? "Active" : "Idle"}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-2xs">
        <dt className="text-muted">Type</dt><dd className="truncate text-secondary">{tab.kind === "studio" ? "Conversation" : "Local coding session"}</dd>
        {projectName && <><dt className="text-muted">Project</dt><dd className="truncate text-secondary">{projectName}</dd></>}
        {tab.cwd && <><dt className="text-muted">Folder</dt><dd className="flex min-w-0 items-center gap-1 text-secondary"><FolderOpen size="xs" className="flex-shrink-0" /><span className="truncate">{tab.cwd}</span></dd></>}
        {tab.kind === "studio" && <><dt className="text-muted">Workspace</dt><dd className="truncate text-secondary">{tab.workspaceLabel || "No project selected"}</dd></>}
      </dl>
    </motion.div>
  );
}
