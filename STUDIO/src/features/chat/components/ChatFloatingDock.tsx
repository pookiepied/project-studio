import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretDownIcon as CaretDown,
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
import { formatDate } from "@/lib/formatters";
import { useNavigation } from "@/app/contexts/NavigationContext";
import { ClaudeCodeIcon, StudioMark } from "@/ui/brand";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";

type BrowserTab = "conversations" | "projects";

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
  const [mode, setMode] = useState<"navigation" | "conversation">(active ? "conversation" : "navigation");
  // Resting-dock collapse: when collapsed the app-space categories fold away and
  // only Studio + the conversation/project picker remain (chat page only).
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTab, setBrowserTab] = useState<BrowserTab>("conversations");
  const [projectQuery, setProjectQuery] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const previousActiveRef = useRef(active);

  const projectEnabled = scope === "local";
  const showConversationMode = active && mode === "conversation";
  const hasActivity = conversationStatuses && conversationStatuses.size > 0;
  // A conversation only belongs to a project in local scope with a folder
  // actually attached — a plain local chat (or any cloud chat) is not a
  // project, so it shows no folder icon, just its title.
  const hasProject = projectEnabled && !!currentProjectPath && !!projectName;

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) =>
      `${project.name} ${project.path}`.toLowerCase().includes(q),
    );
  }, [projects, projectQuery]);

  const filteredConversations = useMemo(() => {
    const q = conversationQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conv) =>
      `${conv.title} ${conv.projectName ?? ""} ${conv.storageScope ?? ""}`.toLowerCase().includes(q),
    );
  }, [conversations, conversationQuery]);

  useEffect(() => {
    if (active && !previousActiveRef.current) {
      setMode("conversation");
    } else if (!active) {
      setMode("navigation");
    }
    previousActiveRef.current = active;
  }, [active]);

  const openBrowser = (tab: BrowserTab) => {
    setBrowserTab(tab);
    setBrowserOpen(true);
  };

  return (
    <>
      <FloatingPanelFrame dockClassName={showConversationMode ? "px-1.5" : ""}>
        <AnimatePresence mode="wait" initial={false}>
          {showConversationMode ? (
            <motion.div
              key="conversation-dock"
              initial={{ opacity: 0, y: -4, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 4, filter: "blur(2px)" }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-1"
            >
              <button
                type="button"
                onClick={() => setMode("navigation")}
                aria-label="Show navigation"
                title="Show navigation"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
              >
                <SidebarSimple size={14} weight="regular" />
              </button>

              <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />

              {/* Unified project / conversation title. Fixed width so the dock
                  never grows or shrinks with the title — the conversation name
                  is centered and truncates to `…`. Only the caret is clickable
                  (it opens the combined browser); the title itself is display
                  only, so the whole capsule no longer reads as one big button. */}
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
                <button
                  type="button"
                  onClick={() => openBrowser("conversations")}
                  aria-expanded={browserOpen}
                  aria-label="Browse conversations and projects"
                  title="Browse conversations and projects"
                  className={`absolute right-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${
                    browserOpen ? "bg-surface-selected text-primary" : "text-muted hover:bg-surface-hover hover:text-primary"
                  }`}
                >
                  <CaretDown size={12} weight="bold" className={`transition-transform ${browserOpen ? "rotate-180" : ""}`} />
                </button>
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
              initial={{ opacity: 0, y: -4, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 4, filter: "blur(2px)" }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-1"
            >
              {/* Resting dock expand/collapse. Expanded shows the full app-space
                  switcher; clicking the conversation glyph folds the categories
                  away to just Studio + a conversation/project picker. The Studio
                  mark expands them back. The FloatingPanelFrame's layout spring
                  morphs the width for the Apple-style ease. */}
              <AnimatePresence mode="wait" initial={false}>
                {navCollapsed ? (
                  <motion.div
                    key="nav-collapsed"
                    initial={{ opacity: 0, filter: "blur(2px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(2px)" }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-1"
                  >
                    <button
                      type="button"
                      onClick={() => setNavCollapsed(false)}
                      aria-label="Show navigation"
                      title="Show navigation"
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-surface-hover"
                    >
                      <StudioMark size={16} className="text-primary" />
                    </button>
                    <span className="mx-0.5 h-4 w-px bg-surface-divider" />
                    <button
                      type="button"
                      onClick={() => openBrowser("conversations")}
                      className={`relative flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors ${
                        browserOpen && browserTab === "conversations" ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
                      }`}
                    >
                      <ChatCircle size={14} weight={currentConvId ? "fill" : "regular"} />
                      Conversations
                      {hasActivity && <span className="absolute left-6 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => openBrowser("projects")}
                      className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors ${
                        browserOpen && browserTab === "projects" ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
                      }`}
                    >
                      <FolderOpen size={14} weight={currentProjectPath ? "fill" : "regular"} />
                      Projects
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="nav-expanded"
                    initial={{ opacity: 0, filter: "blur(2px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(2px)" }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-1"
                  >
                    <FloatingPanelNavigation currentView={currentView} onNavigate={navigateTo} />
                    <span className="mx-0.5 h-4 w-px bg-surface-divider" />
                    <button
                      type="button"
                      onClick={() => setNavCollapsed(true)}
                      className="relative flex h-7 w-7 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
                      aria-label="Pick a conversation or project"
                      title="Pick a conversation or project"
                    >
                      <ChatCircle size={14} weight={currentConvId ? "fill" : "regular"} />
                      {hasActivity && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </FloatingPanelFrame>

      <AnimatePresence>
        {browserOpen && (
          <motion.div
            key="workspace-browser"
            role="dialog"
            aria-label="Project and conversation browser"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.75 }}
            className="fixed left-1/2 top-[50px] z-popover w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-surface-border bg-surface-base shadow-2xl"
          >
            {/* Combined browser: one popover, two tabs. Picking a conversation
                loads its project automatically (handled downstream), so
                conversations are the default landing tab. */}
            <div className="flex items-center gap-1 border-b border-surface-divider p-2">
              <TabButton active={browserTab === "conversations"} onClick={() => setBrowserTab("conversations")}>
                <ChatCircle size={13} weight={browserTab === "conversations" ? "fill" : "regular"} />
                Conversations
              </TabButton>
              <TabButton active={browserTab === "projects"} onClick={() => setBrowserTab("projects")}>
                <FolderOpen size={13} weight={browserTab === "projects" ? "fill" : "regular"} />
                Projects
              </TabButton>
              <button
                type="button"
                onClick={() => setBrowserOpen(false)}
                aria-label="Close"
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-primary"
              >
                <X size={14} weight="bold" />
              </button>
            </div>

            {browserTab === "projects" ? (
              <ProjectBrowser
                enabled={projectEnabled}
                projects={filteredProjects}
                query={projectQuery}
                currentProjectPath={currentProjectPath}
                onQueryChange={setProjectQuery}
                onSelectProject={(project) => {
                  if (!projectEnabled) return;
                  onSelectProject(project);
                  setBrowserTab("conversations");
                }}
                onOpenProjectFolder={() => {
                  if (!projectEnabled) return;
                  onOpenProjectFolder();
                  setBrowserOpen(false);
                }}
                onRemoveProject={onRemoveProject}
                onDeleteProject={onDeleteProject}
                onSwitchLocal={() => onScopeChange("local")}
              />
            ) : (
              <ConversationBrowser
                conversations={filteredConversations}
                query={conversationQuery}
                currentConvId={currentConvId}
                conversationStatuses={conversationStatuses}
                editingConvId={editingConvId}
                editingConvTitle={editingConvTitle}
                onQueryChange={setConversationQuery}
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
        active ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function BrowserHeader({
  subtitle,
  query,
  placeholder,
  onQueryChange,
}: {
  subtitle: string;
  query: string;
  placeholder: string;
  onQueryChange: (value: string) => void;
}) {
  return (
    <div className="border-b border-surface-divider p-3">
      <p className="mb-2.5 px-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>
      <label className="flex h-8 items-center gap-2 rounded-xl border border-surface-border bg-surface-page px-3 text-muted">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-xs text-primary outline-none placeholder:text-muted"
        />
      </label>
    </div>
  );
}

function ProjectBrowser({
  enabled,
  projects,
  query,
  currentProjectPath,
  onQueryChange,
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
  onSwitchLocal,
}: {
  enabled: boolean;
  projects: ProjectEntry[];
  query: string;
  currentProjectPath?: string;
  onQueryChange: (value: string) => void;
  onSelectProject: (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSwitchLocal: () => void;
}) {
  return (
    <>
      <BrowserHeader
        subtitle={enabled ? "Local workspaces available on this machine." : "Local projects require the Local environment."}
        query={query}
        placeholder="Search projects"
        onQueryChange={onQueryChange}
      />
      {!enabled ? (
        <div className="p-4">
          <div className="rounded-xl border border-surface-border bg-surface-page p-4">
            <p className="text-sm font-semibold text-primary">Cloud environment is active</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Project folders live on this computer. Switch to Local to browse or attach a project.
            </p>
            <button type="button" onClick={onSwitchLocal} className="mt-3 rounded-full bg-surface-selected px-3 py-1.5 text-xs font-medium text-primary hover:bg-surface-hover">
              Switch to Local
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="p-2">
            <button type="button" onClick={onOpenProjectFolder} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface-hover">
              <Plus size={14} weight="bold" />
              Open project folder
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto px-2 pb-2">
            {projects.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-primary">No local projects found</p>
                <p className="mt-1 text-xs text-muted">{query ? "Try another search." : "Open a folder to start working in a project."}</p>
              </div>
            ) : (
              projects.map((project) => {
                const current = project.path === currentProjectPath;
                return (
                  <div key={project.id} className={`group relative mb-1 rounded-xl ${current ? "bg-surface-selected" : ""}`}>
                    <button type="button" onClick={() => onSelectProject(project)} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover">
                      <div className="flex items-center gap-2 pr-16">
                        <FolderOpen size={14} weight={current ? "fill" : "regular"} className="text-secondary" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{project.name}</span>
                        <span className="rounded-full border border-surface-border px-1.5 py-0.5 text-2xs font-medium text-muted">Local</span>
                      </div>
                      <p className="mt-0.5 truncate pl-6 text-xs text-muted">{project.path}</p>
                    </button>
                    <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                      <button type="button" title="Remove from list" onClick={(event) => { event.stopPropagation(); onRemoveProject(project.id); }} className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary">
                        <X size={12} weight="bold" />
                      </button>
                      <button type="button" title="Delete Studio project data" onClick={(event) => { event.stopPropagation(); onDeleteProject(project.id); }} className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary">
                        <Trash size={12} weight="bold" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}

function ConversationBrowser({
  conversations,
  query,
  currentConvId,
  conversationStatuses,
  editingConvId,
  editingConvTitle,
  onQueryChange,
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
  query: string;
  currentConvId?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  editingConvId: string | null;
  editingConvTitle: string;
  onQueryChange: (value: string) => void;
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
  // Menu is portalled to <body> at a fixed position so it is never clipped by
  // the browser's own `overflow-y-auto` scroll region.
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);

  return (
    <>
      <BrowserHeader
        subtitle="Recent threads, filtered to the current environment and project when applicable."
        query={query}
        placeholder="Search conversations"
        onQueryChange={onQueryChange}
      />
      <div className="p-2">
        <button type="button" onClick={onNewConversation} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface-hover">
          <Plus size={14} weight="bold" />
          Start new conversation
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-primary">No conversations here</p>
            <p className="mt-1 text-xs text-muted">{query ? "Try another search." : "Start a new conversation from the dock."}</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const status = conversationStatuses?.get(conv.id);
            const current = conv.id === currentConvId;
            const isClaudeOwned = conv.owner === "claude";
            const menuOpen = menu?.id === conv.id;
            return (
              <div
                key={conv.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ id: conv.id, top: event.clientY, right: Math.max(8, window.innerWidth - event.clientX) });
                }}
                className={`group relative mb-1 rounded-xl ${current ? "bg-surface-selected" : ""}`}
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
                  <button type="button" onClick={() => onSelectConversation(conv.id)} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover">
                    <div className="flex items-center gap-2 pr-16">
                      {isClaudeOwned ? <ClaudeCodeIcon size={14} /> : <ChatCircle size={14} weight={current ? "fill" : "regular"} className="text-secondary" />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{conv.title}</span>
                      {status === "streaming" && <span className="h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />}
                      {status === "done_unread" && <CheckCircle size={14} weight="fill" className="text-secondary" />}
                      {status === "permission_needed" && <WarningCircle size={14} weight="fill" className="text-secondary" />}
                    </div>
                    <p className="mt-0.5 truncate pl-6 text-xs text-muted">
                      {conv.projectName ?? (conv.storageScope === "local" ? "Local" : "Cloud")} · {conv.messageCount} messages · {formatDate(conv.updatedAt)}
                    </p>
                  </button>
                )}
                {editingConvId !== conv.id && (
                  <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 gap-1 group-hover:flex">
                    <ConversationActionsButton
                      open={menuOpen}
                      onOpen={(rect) => setMenu({ id: conv.id, top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })}
                      onClose={() => setMenu(null)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {menu && (() => {
        const conv = conversations.find((c) => c.id === menu.id);
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
    </>
  );
}

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
    <button
      type="button"
      title="Conversation actions"
      onClick={(event) => {
        event.stopPropagation();
        if (open) onClose();
        else onOpen(event.currentTarget.getBoundingClientRect());
      }}
      className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
    >
      <DotsThree size={14} weight="bold" />
    </button>
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
  const itemClass = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-secondary hover:bg-surface-hover hover:text-primary";
  return createPortal(
    <>
      {/* Backdrop closes the menu on any outside click. */}
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onMouseDown={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
        className="w-48 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
      >
        {/* "Open" is pointless on the conversation you're already in. */}
        {!isCurrent && (
          <button
            type="button"
            onClick={() => {
              onSelectConversation(conv.id);
              onClose();
              onPanelClose();
            }}
            className={itemClass}
          >
            <ChatCircle size={14} /> Open
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onOpenConversationInSideChat?.(conv.id, conv.title);
            onClose();
          }}
          className={itemClass}
        >
          <SidebarSimple size={14} /> Open in Side Chat
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenConversationInNewWindow?.(conv.id);
            onClose();
          }}
          className={itemClass}
        >
          <Stack size={14} /> Open in New Window
        </button>
        {!isClaudeOwned && (
          <>
            <div className="my-1 h-px bg-surface-divider" />
            <button type="button" onClick={(event) => { onStartEditTitle(conv.id, conv.title, event); onClose(); }} className={itemClass}>
              <PencilSimple size={14} /> Rename
            </button>
            <button type="button" onClick={(event) => { onDeleteConversation(conv.id, event); onClose(); }} className={itemClass}>
              <Trash size={14} /> Delete
            </button>
          </>
        )}
      </motion.div>
    </>,
    document.body,
  );
}
