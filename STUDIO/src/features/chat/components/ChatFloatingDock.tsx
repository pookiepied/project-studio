import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  ChatCircleIcon as ChatCircle,
  CheckCircleIcon as CheckCircle,
  DotsThreeIcon as DotsThree,
  FolderOpenIcon as FolderOpen,
  MagnifyingGlassIcon as Search,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  SidebarSimpleIcon as SidebarSimple,
  StackIcon as Stack,
  TrashIcon as Trash,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "@phosphor-icons/react";
import {
  FloatingPanelFrame,
  FloatingPanelNavigation,
} from "@/app/shell/FloatingPanel";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { formatDate } from "@/lib/formatters";
import { useNavigation } from "@/app/contexts/NavigationContext";
import { ClaudeCodeIcon, StudioMark } from "@/ui/brand";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
const EASE = [0.16, 1, 0.3, 1] as const;

function normPath(p?: string | null): string {
  return p?.trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase() ?? "";
}

interface ChatFloatingDockProps {
  active: boolean;
  conversationTitle?: string;
  projectName?: string;
  scope: ConversationStorageScope;
  onScopeChange: (scope: ConversationStorageScope) => void;
  projects: ProjectEntry[];
  currentProjectPath?: string;
  conversations: ConversationMetadata[];
  currentConvId?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  contextControls?: ReactNode;
  accountControl?: ReactNode;
  onSelectProject: (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onNewConversation: () => void;
  onStartEditTitle: (id: string, title: string, e: React.MouseEvent) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  editingConvId: string | null;
  editingConvTitle: string;
  onEditTitleChange: (value: string) => void;
  onSaveConvTitle: (id: string) => void;
  onCancelConvEdit: () => void;
}

export function ChatFloatingDock({
  active,
  conversationTitle,
  projectName,
  scope,
  onScopeChange,
  projects,
  currentProjectPath,
  conversations,
  currentConvId,
  conversationStatuses,
  contextControls,
  accountControl,
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
  onSelectConversation,
  onOpenConversationInSideChat,
  onOpenConversationInNewWindow,
  onNewConversation,
  onStartEditTitle,
  onDeleteConversation,
  editingConvId,
  editingConvTitle,
  onEditTitleChange,
  onSaveConvTitle,
  onCancelConvEdit,
}: ChatFloatingDockProps) {
  const { currentView, navigateTo } = useNavigation();
  const [mode, setMode] = useState<"navigation" | "conversation">(
    active ? "conversation" : "navigation",
  );
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserQuery, setBrowserQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const previousActiveRef = useRef(active);

  const projectEnabled = scope === "local";
  const showConversationMode = active && mode === "conversation";
  const hasActivity = conversationStatuses && conversationStatuses.size > 0;
  const hasProject = projectEnabled && !!currentProjectPath && !!projectName;

  useEffect(() => {
    if (active && !previousActiveRef.current) {
      setMode("conversation");
    } else if (!active) {
      setMode("navigation");
    }
    previousActiveRef.current = active;
  }, [active]);

  // Auto-expand the active project when the browser opens.
  useEffect(() => {
    if (browserOpen && currentProjectPath) {
      const key = normPath(currentProjectPath);
      setExpandedProjects((prev) =>
        prev.has(key) ? prev : new Set(prev).add(key),
      );
    }
  }, [browserOpen, currentProjectPath]);

  const toggleProject = (key: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openBrowser = () => setBrowserOpen(true);

  return (
    <>
      <FloatingPanelFrame dockClassName={showConversationMode ? "px-1.5" : ""}>
        {/* Single persistent wrapper — the `layout` spring morphs the dock
            width when content changes, so it reads as one continuous dock
            resizing rather than two separate docks swapping in/out. */}
        <motion.div layout className="flex items-center gap-1">
          {/* Always-present brand mark — toggles between nav and conversation
              modes. Staying pinned while everything rearranges is what gives
              the Apple-style "same dock, different size" feel. */}
          <IconButton
            size="sm"
            aria-label={showConversationMode ? "Show navigation" : "Open chat"}
            title={showConversationMode ? "Show navigation" : "Open chat"}
            onClick={() => {
              if (showConversationMode) {
                setMode("navigation");
              } else {
                navigateTo("chat");
                if (active) setMode("conversation");
              }
            }}
            className="flex-shrink-0 rounded-full"
          >
            <StudioMark size={16} className="text-primary" />
          </IconButton>

          {/* popLayout: exiting content pops out of flow (absolute) while
              incoming content takes its natural position. Combined with the
              outer `layout` spring the dock smoothly resizes and crossfades
              instead of the hard swap that `mode="wait"` produced. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {showConversationMode ? (
              <motion.div
                key="conversation-dock"
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ opacity: { duration: 0.15, ease: EASE }, x: { duration: 0.15, ease: EASE }, layout: SPRING }}
                className="flex items-center gap-1"
              >
                <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />

                <div className="relative flex h-7 w-[300px] items-center justify-center gap-1.5 rounded-full pl-2.5 pr-7 text-xs font-medium">
                  {hasProject ? (
                    <>
                      <FolderOpen size={14} weight="fill" className="flex-shrink-0 text-secondary" />
                      <span className="max-w-[110px] flex-shrink-0 truncate text-secondary">{projectName}</span>
                      <span className="flex-shrink-0 text-muted">/</span>
                    </>
                  ) : (
                    <ChatCircle size={14} weight={currentConvId ? "fill" : "regular"} className="flex-shrink-0 text-secondary" />
                  )}
                  <span className="min-w-0 truncate text-primary">{conversationTitle ?? "New chat"}</span>
                  {hasActivity && <span className="absolute left-1 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />}
                  <IconButton
                    aria-label="Browse conversations and projects"
                    title="Browse conversations and projects"
                    onClick={openBrowser}
                    aria-expanded={browserOpen}
                    className={`absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full ${
                      browserOpen ? "bg-surface-selected text-primary" : "text-muted hover:bg-surface-hover hover:text-primary"
                    }`}
                  >
                    <CaretDown size={12} weight="bold" className={`transition-transform ${browserOpen ? "rotate-180" : ""}`} />
                  </IconButton>
                </div>

                {contextControls && (
                  <>
                    <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />
                    {contextControls}
                  </>
                )}

                {accountControl && (
                  <>
                    <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />
                    {accountControl}
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="navigation-dock"
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ opacity: { duration: 0.15, ease: EASE }, x: { duration: 0.15, ease: EASE }, layout: SPRING }}
                className="flex items-center gap-1"
              >
                <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />

                <FloatingPanelNavigation currentView={currentView} onNavigate={navigateTo} hideBrand />

                <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />

                <IconButton
                  size="sm"
                  aria-label="Browse conversations and projects"
                  title="Browse conversations and projects"
                  onClick={openBrowser}
                  className={`relative rounded-full ${
                    browserOpen ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
                  }`}
                >
                  <ChatCircle size={14} weight={currentConvId ? "fill" : "regular"} />
                  {hasActivity && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </FloatingPanelFrame>

      <AnimatePresence>
        {browserOpen && (
          <UnifiedBrowser
            conversations={conversations}
            projects={projects}
            projectEnabled={projectEnabled}
            currentConvId={currentConvId}
            currentProjectPath={currentProjectPath}
            conversationStatuses={conversationStatuses}
            editingConvId={editingConvId}
            editingConvTitle={editingConvTitle}
            query={browserQuery}
            expandedProjects={expandedProjects}
            onQueryChange={setBrowserQuery}
            onToggleProject={toggleProject}
            onSelectProject={(project) => {
              if (!projectEnabled) return;
              onSelectProject(project);
            }}
            onOpenProjectFolder={() => {
              if (!projectEnabled) return;
              onOpenProjectFolder();
              setBrowserOpen(false);
            }}
            onRemoveProject={onRemoveProject}
            onDeleteProject={onDeleteProject}
            onSwitchLocal={() => onScopeChange("local")}
            onSelectConversation={(id) => {
              onSelectConversation(id);
              setBrowserOpen(false);
            }}
            onOpenConversationInSideChat={(id, title) => {
              onOpenConversationInSideChat?.(id, title);
              setBrowserOpen(false);
            }}
            onOpenConversationInNewWindow={(id) => {
              onOpenConversationInNewWindow?.(id);
              setBrowserOpen(false);
            }}
            onNewConversation={() => {
              onNewConversation();
              setBrowserOpen(false);
            }}
            onDeleteConversation={onDeleteConversation}
            onStartEditTitle={onStartEditTitle}
            onSaveConvTitle={onSaveConvTitle}
            onCancelConvEdit={onCancelConvEdit}
            onEditTitleChange={onEditTitleChange}
            onClose={() => setBrowserOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Unified tree browser ──────────────────────────────────────────────────

interface ProjectGroup {
  project?: ProjectEntry;
  name: string;
  path: string;
  conversations: ConversationMetadata[];
}

function UnifiedBrowser({
  conversations,
  projects,
  projectEnabled,
  currentConvId,
  currentProjectPath,
  conversationStatuses,
  editingConvId,
  editingConvTitle,
  query,
  expandedProjects,
  onQueryChange,
  onToggleProject,
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
  onSwitchLocal,
  onSelectConversation,
  onOpenConversationInSideChat,
  onOpenConversationInNewWindow,
  onNewConversation,
  onDeleteConversation,
  onStartEditTitle,
  onSaveConvTitle,
  onCancelConvEdit,
  onEditTitleChange,
  onClose,
}: {
  conversations: ConversationMetadata[];
  projects: ProjectEntry[];
  projectEnabled: boolean;
  currentConvId?: string;
  currentProjectPath?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  editingConvId: string | null;
  editingConvTitle: string;
  query: string;
  expandedProjects: Set<string>;
  onQueryChange: (value: string) => void;
  onToggleProject: (key: string) => void;
  onSelectProject: (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSwitchLocal: () => void;
  onSelectConversation: (id: string) => void;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onStartEditTitle: (id: string, title: string, e: React.MouseEvent) => void;
  onSaveConvTitle: (id: string) => void;
  onCancelConvEdit: () => void;
  onEditTitleChange: (value: string) => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isSearching = query.trim().length > 0;

  const treeData = useMemo(() => {
    const q = query.trim().toLowerCase();
    let convs = conversations;
    if (q) {
      convs = conversations.filter((c) =>
        `${c.title} ${c.projectName ?? ""} ${c.storageScope ?? ""}`.toLowerCase().includes(q),
      );
    }

    const byProject = new Map<string, ProjectGroup>();
    const loose: ConversationMetadata[] = [];

    if (!isSearching) {
      for (const p of projects) {
        const key = normPath(p.path);
        if (!byProject.has(key)) {
          byProject.set(key, { project: p, name: p.name, path: p.path, conversations: [] });
        }
      }
    }

    for (const conv of convs) {
      const key = normPath(conv.projectPath);
      if (key) {
        let group = byProject.get(key);
        if (!group) {
          group = {
            name: conv.projectName ?? conv.projectPath ?? "Project",
            path: conv.projectPath!,
            conversations: [],
          };
          byProject.set(key, group);
        }
        group.conversations.push(conv);
      } else {
        loose.push(conv);
      }
    }

    for (const g of byProject.values()) {
      g.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    loose.sort((a, b) => b.updatedAt - a.updatedAt);

    return { loose, projectList: Array.from(byProject.values()) };
  }, [conversations, projects, query, isSearching]);

  const allMatchingConversations = useMemo(() => {
    if (!isSearching) return [];
    return [...treeData.loose, ...treeData.projectList.flatMap((g) => g.conversations)];
  }, [treeData, isSearching]);

  const renderItem = (conv: ConversationMetadata) => (
    <ConversationRow
      key={conv.id}
      conv={conv}
      currentConvId={currentConvId}
      conversationStatuses={conversationStatuses}
      editingConvId={editingConvId}
      editingConvTitle={editingConvTitle}
      onSelectConversation={onSelectConversation}
      onSaveConvTitle={onSaveConvTitle}
      onCancelConvEdit={onCancelConvEdit}
      onEditTitleChange={onEditTitleChange}
      onOpenMenu={(rect) => setMenu({ id: conv.id, top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })}
      menuOpen={menu?.id === conv.id}
      onCloseMenu={() => setMenu(null)}
    />
  );

  return (
    <motion.div
      key="workspace-browser"
      role="dialog"
      aria-label="Conversations and projects"
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.75 }}
      className="fixed left-1/2 top-[50px] z-popover w-[460px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-surface-border bg-surface-base shadow-2xl"
    >
      {/* Header: search row + dual action buttons */}
      <div className="border-b border-surface-divider p-2">
        <div className="flex items-center gap-1">
          <label className="flex h-8 flex-1 items-center gap-2 rounded-xl border border-surface-border bg-surface-page px-3 text-muted">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search conversations and projects"
              className="min-w-0 flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-muted"
            />
          </label>
          <IconButton
            aria-label="Close"
            onClick={onClose}
            className="flex-shrink-0 rounded-full text-muted hover:bg-surface-hover hover:text-primary"
          >
            <X size={14} weight="bold" />
          </IconButton>
        </div>
        {/* Two distinct entry points: start a conversation vs open a project folder */}
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="ghost"
            onClick={onNewConversation}
            className="flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-page py-2 text-xs font-medium text-primary hover:bg-surface-hover"
          >
            <ChatCircle size={14} weight="bold" />
            New conversation
          </Button>
          <Button
            variant="ghost"
            onClick={onOpenProjectFolder}
            disabled={!projectEnabled}
            title={projectEnabled ? "Open a folder as a project" : "Switch to Local to open a project"}
            className="flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-page py-2 text-xs font-medium text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen size={14} weight="bold" />
            Open project
          </Button>
        </div>
      </div>

      {/* Tree content */}
      <div ref={listRef} className="max-h-[400px] overflow-y-auto px-2 py-2">
        {/* Not-enabled notice for cloud users */}
        {!projectEnabled && !isSearching && (
          <div className="mb-2 rounded-xl border border-surface-border bg-surface-page p-3">
            <p className="text-xs font-semibold text-primary">Cloud environment is active</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Project folders live on this computer. Switch to Local to browse or attach a project.
            </p>
            <Button
              variant="ghost"
              onClick={onSwitchLocal}
              className="mt-2 rounded-full bg-surface-selected px-3 py-1.5 text-xs font-medium text-primary hover:bg-surface-hover"
            >
              Switch to Local
            </Button>
          </div>
        )}

        {treeData.loose.length === 0 && treeData.projectList.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-primary">Nothing found</p>
            <p className="mt-1 text-xs text-muted">
              {query ? "Try another search." : "Start a new conversation or add a project."}
            </p>
          </div>
        ) : isSearching ? (
          allMatchingConversations.map(renderItem)
        ) : (
          <>
            {/* Loose conversations (no project attached) */}
            {treeData.loose.length > 0 && (
              <div className="mb-2">
                <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                  Conversations
                </p>
                {treeData.loose.map(renderItem)}
              </div>
            )}

            {/* Project folders */}
            {treeData.projectList.length > 0 && (
              <div>
                {treeData.projectList.map((group) => {
                  const key = normPath(group.path);
                  const expanded = expandedProjects.has(key);
                  const isCurrent = normPath(currentProjectPath) === key;
                  return (
                    <div key={group.path} className="mb-0.5">
                      <ProjectRow
                        name={group.name}
                        path={group.path}
                        expanded={expanded}
                        isCurrent={isCurrent}
                        projectEnabled={projectEnabled}
                        hasRegisteredProject={!!group.project}
                        conversationCount={group.conversations.length}
                        onToggle={() => onToggleProject(key)}
                        onSelect={() => group.project && onSelectProject(group.project)}
                        onOpenFolder={onOpenProjectFolder}
                        onRemove={() => group.project && onRemoveProject(group.project.id)}
                        onDelete={() => group.project && onDeleteProject(group.project.id)}
                      />
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: EASE }}
                            className="overflow-hidden"
                          >
                            <div className="pl-3 pt-0.5">
              {group.conversations.length === 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (group.project) onSelectProject(group.project);
                    onNewConversation();
                  }}
                  className="mx-3 my-1 w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-primary"
                >
                  <Plus size={12} weight="bold" />
                  Start conversation in this project
                </Button>
              ) : (
                group.conversations.map(renderItem)
              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Context menu (right-click or actions button) */}
      {menu && (() => {
        const conv = allMatchingConversations.find((c) => c.id === menu.id)
          ?? conversations.find((c) => c.id === menu.id);
        if (!conv) return null;
        return (
          <ConversationActionsMenu
            conv={conv}
            isClaudeOwned={conv.owner === "claude"}
            isCurrent={conv.id === currentConvId}
            pos={{ top: menu.top, right: menu.right }}
            onSelectConversation={onSelectConversation}
            onOpenConversationInSideChat={onOpenConversationInSideChat}
            onOpenConversationInNewWindow={onOpenConversationInNewWindow}
            onStartEditTitle={onStartEditTitle}
            onDeleteConversation={onDeleteConversation}
            onClose={() => setMenu(null)}
            onPanelClose={onClose}
          />
        );
      })()}
    </motion.div>
  );
}

// ─── Rows ──────────────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  currentConvId,
  conversationStatuses,
  editingConvId,
  editingConvTitle,
  onSelectConversation,
  onSaveConvTitle,
  onCancelConvEdit,
  onEditTitleChange,
  onOpenMenu,
  menuOpen,
  onCloseMenu,
}: {
  conv: ConversationMetadata;
  currentConvId?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  editingConvId: string | null;
  editingConvTitle: string;
  onSelectConversation: (id: string) => void;
  onSaveConvTitle: (id: string) => void;
  onCancelConvEdit: () => void;
  onEditTitleChange: (value: string) => void;
  onOpenMenu: (rect: DOMRect) => void;
  menuOpen: boolean;
  onCloseMenu: () => void;
}) {
  const status = conversationStatuses?.get(conv.id);
  const current = conv.id === currentConvId;
  const isClaudeOwned = conv.owner === "claude";

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(event.currentTarget.getBoundingClientRect());
      }}
      className={`group relative mb-0.5 rounded-xl ${current ? "bg-surface-selected" : ""}`}
    >
      {editingConvId === conv.id ? (
        <div className="p-2">
          <input
            autoFocus
            value={editingConvTitle}
            onChange={(event) => onEditTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSaveConvTitle(conv.id);
              if (event.key === "Escape") onCancelConvEdit();
            }}
            className="w-full rounded-lg border border-surface-border bg-surface-page px-2 py-1.5 text-xs text-primary outline-none"
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => onSelectConversation(conv.id)}
          className="w-full rounded-xl px-3 py-2 text-left hover:bg-surface-hover"
        >
          <div className="flex items-center gap-2 pr-6">
            {isClaudeOwned ? (
              <ClaudeCodeIcon size={13} />
            ) : (
              <ChatCircle size={13} weight={current ? "fill" : "regular"} className="text-secondary" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{conv.title}</span>
            {status === "streaming" && (
              <span className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            )}
            {status === "done_unread" && <CheckCircle size={13} weight="fill" className="text-secondary" />}
            {status === "permission_needed" && <WarningCircle size={13} weight="fill" className="text-secondary" />}
          </div>
          <p className="mt-0.5 truncate pl-5 text-2xs text-muted">
            {conv.messageCount} messages · {formatDate(conv.updatedAt)}
          </p>
        </Button>
      )}

      {editingConvId !== conv.id && (
        <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 group-hover:flex">
          <ConversationActionsButton open={menuOpen} onOpen={onOpenMenu} onClose={onCloseMenu} />
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  name,
  path,
  expanded,
  isCurrent,
  projectEnabled,
  hasRegisteredProject,
  conversationCount,
  onToggle,
  onSelect,
  onOpenFolder,
  onRemove,
  onDelete,
}: {
  name: string;
  path: string;
  expanded: boolean;
  isCurrent: boolean;
  projectEnabled: boolean;
  hasRegisteredProject: boolean;
  conversationCount: number;
  onToggle: () => void;
  onSelect: () => void;
  onOpenFolder: () => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group relative rounded-xl ${isCurrent ? "bg-surface-selected" : ""}`}>
      <div className="flex items-center">
        <IconButton
          aria-label={expanded ? "Collapse project" : "Expand project"}
          onClick={onToggle}
          className="h-7 w-6 flex-shrink-0 rounded-l-xl text-muted hover:text-primary"
        >
          <CaretRight size={12} weight="bold" className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </IconButton>
        <Button
          variant="ghost"
          onClick={onSelect}
          disabled={!projectEnabled || !hasRegisteredProject}
          className="min-w-0 flex-1 items-center gap-2 py-2 pr-16 text-left disabled:opacity-60"
        >
          <FolderOpen size={13} weight={isCurrent ? "fill" : "regular"} className="flex-shrink-0 text-secondary" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">{name}</span>
          {conversationCount > 0 && (
            <span className="rounded-full bg-surface-page px-1.5 py-0.5 text-2xs font-medium text-muted">
              {conversationCount}
            </span>
          )}
        </Button>
      </div>
      <p className="truncate pl-6 pr-2 pb-1 text-2xs text-muted">{path}</p>

      {hasRegisteredProject && (
        <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
          <IconButton
            aria-label="Open folder"
            title="Open folder"
            onClick={(event) => { event.stopPropagation(); onOpenFolder(); }}
            className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
          >
            <FolderOpen size={11} weight="bold" />
          </IconButton>
          <IconButton
            aria-label="Remove from list"
            title="Remove from list"
            onClick={(event) => { event.stopPropagation(); onRemove(); }}
            className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
          >
            <X size={11} weight="bold" />
          </IconButton>
          <IconButton
            aria-label="Delete Studio project data"
            title="Delete Studio project data"
            onClick={(event) => { event.stopPropagation(); onDelete(); }}
            className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
          >
            <Trash size={11} weight="bold" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

// ─── Context menu (reused as-is) ───────────────────────────────────────────

function ConversationActionsButton({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: (rect: DOMRect) => void;
  onClose: () => void;
}) {
  return (
    <IconButton
      aria-label="Conversation actions"
      title="Conversation actions"
      onClick={(event) => {
        event.stopPropagation();
        if (open) onClose();
        else onOpen(event.currentTarget.getBoundingClientRect());
      }}
      className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
    >
      <DotsThree size={14} weight="bold" />
    </IconButton>
  );
}

function ConversationActionsMenu({
  conv,
  isClaudeOwned,
  isCurrent,
  pos,
  onSelectConversation,
  onOpenConversationInSideChat,
  onOpenConversationInNewWindow,
  onStartEditTitle,
  onDeleteConversation,
  onClose,
  onPanelClose,
}: {
  conv: ConversationMetadata;
  isClaudeOwned: boolean;
  isCurrent: boolean;
  pos: { top: number; right: number };
  onSelectConversation: (id: string) => void;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onStartEditTitle: (id: string, title: string, e: React.MouseEvent) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onClose: () => void;
  onPanelClose: () => void;
}) {
  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-secondary hover:bg-surface-hover hover:text-primary";
  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onMouseDown={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
        className="w-48 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
      >
        {!isCurrent && (
          <Button
            variant="ghost"
            onClick={() => {
              onSelectConversation(conv.id);
              onClose();
              onPanelClose();
            }}
            className={itemClass}
          >
            <ChatCircle size={14} /> Open
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            onOpenConversationInSideChat?.(conv.id, conv.title);
            onClose();
          }}
          className={itemClass}
        >
          <SidebarSimple size={14} /> Open in Side Chat
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onOpenConversationInNewWindow?.(conv.id);
            onClose();
          }}
          className={itemClass}
        >
          <Stack size={14} /> Open in New Window
        </Button>
        {!isClaudeOwned && (
          <>
            <div className="my-1 h-px bg-surface-divider" />
            <Button
              variant="ghost"
              onClick={(event) => { onStartEditTitle(conv.id, conv.title, event); onClose(); }}
              className={itemClass}
            >
              <PencilSimple size={14} /> Rename
            </Button>
            <Button
              variant="ghost"
              onClick={(event) => { onDeleteConversation(conv.id, event); onClose(); }}
              className={itemClass}
            >
              <Trash size={14} /> Delete
            </Button>
          </>
        )}
      </motion.div>
    </>,
    document.body,
  );
}
