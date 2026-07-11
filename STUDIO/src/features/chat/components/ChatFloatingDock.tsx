import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { EnvironmentSelector } from "@/features/chat/components/EnvironmentSelector";
import { formatDate } from "@/lib/formatters";
import { useNavigation } from "@/app/contexts/NavigationContext";
import { ClaudeCodeIcon, StudioMark } from "@/ui/brand";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";

type BrowserKind = "projects" | "conversations" | null;

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
  rightControls?: ReactNode;
  onSelectProject: (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onNewConversation: () => void;
  onRenameChat: () => void;
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
  rightControls,
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
  onSelectConversation,
  onOpenConversationInSideChat,
  onOpenConversationInNewWindow,
  onNewConversation,
  onRenameChat,
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
  const [browser, setBrowser] = useState<BrowserKind>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const previousActiveRef = useRef(active);

  const projectEnabled = scope === "local";
  const showConversationMode = active && mode === "conversation";
  const hasActivity = conversationStatuses && conversationStatuses.size > 0;

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

  const openBrowser = (next: BrowserKind) => {
    setMode("conversation");
    setBrowser((value) => (value === next ? null : next));
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
              className="flex max-w-[calc(100vw-150px)] items-center gap-1"
            >
              <button
                type="button"
                onClick={() => setMode("navigation")}
                aria-label="Show navigation"
                title="Show navigation"
                className="flex h-7 w-7 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
              >
                <SidebarSimple size={14} weight="regular" />
              </button>

              <span className="mx-0.5 h-4 w-px bg-surface-divider" />

              <button
                type="button"
                onClick={() => openBrowser("projects")}
                aria-expanded={browser === "projects"}
                className={`flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors ${
                  browser === "projects"
                    ? "bg-surface-selected text-primary"
                    : "text-secondary hover:bg-surface-hover hover:text-primary"
                }`}
              >
                <FolderOpen size={13} weight={currentProjectPath ? "fill" : "regular"} />
                <span className="max-w-28 truncate">{projectEnabled ? projectName ?? "Projects" : "Cloud"}</span>
              </button>

              <button
                type="button"
                onClick={() => openBrowser("conversations")}
                aria-expanded={browser === "conversations"}
                className={`relative flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors ${
                  browser === "conversations"
                    ? "bg-surface-selected text-primary"
                    : "text-secondary hover:bg-surface-hover hover:text-primary"
                }`}
              >
                <Stack size={13} weight={currentConvId ? "fill" : "regular"} />
                <span className="max-w-48 truncate">{conversationTitle ?? "New chat"}</span>
                <CaretDown size={8} weight="bold" className={`text-muted transition-transform ${browser === "conversations" ? "rotate-180" : ""}`} />
                {hasActivity && <span className="absolute left-4 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>

              {contextControls && (
                <>
                  <span className="mx-0.5 h-4 w-px bg-surface-divider" />
                  {contextControls}
                </>
              )}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOptionsOpen((value) => !value)}
                  title="Chat options"
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                    optionsOpen ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
                  }`}
                >
                  <DotsThree size={14} weight="bold" />
                </button>
                <AnimatePresence>
                  {optionsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.14, ease: "easeOut" }}
                      className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
                    >
                      <button type="button" onClick={() => { setOptionsOpen(false); onRenameChat(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-secondary hover:bg-surface-hover hover:text-primary">
                        <PencilSimple size={13} /> Rename
                      </button>
                      <button type="button" onClick={() => { setOptionsOpen(false); onNewConversation(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-secondary hover:bg-surface-hover hover:text-primary">
                        <Plus size={13} weight="bold" /> New chat
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <span className="mx-0.5 h-4 w-px bg-surface-divider" />
              {accountControl}
              <EnvironmentSelector scope={scope} onScopeChange={onScopeChange} placement="down" />
              {rightControls}
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
              <FloatingPanelNavigation currentView={currentView} onNavigate={navigateTo} />
              <span className="mx-0.5 h-4 w-px bg-surface-divider" />
              <button
                type="button"
                onClick={() => openBrowser("projects")}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  browser === "projects" ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
                }`}
                aria-label="Browse projects"
                title="Browse projects"
              >
                <FolderOpen size={14} weight={currentProjectPath ? "fill" : "regular"} />
              </button>
              <button
                type="button"
                onClick={() => openBrowser("conversations")}
                className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  browser === "conversations" ? "bg-surface-selected text-primary" : "text-secondary hover:bg-surface-hover hover:text-primary"
                }`}
                aria-label="Browse conversations"
                title="Browse conversations"
              >
                <ChatCircle size={14} weight={currentConvId ? "fill" : "regular"} />
                {hasActivity && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
              <EnvironmentSelector scope={scope} onScopeChange={onScopeChange} placement="down" />
              <button
                type="button"
                onClick={onNewConversation}
                className="flex h-7 items-center gap-1.5 rounded-full bg-surface-selected px-2.5 text-xs font-medium text-primary transition-colors hover:bg-surface-hover"
              >
                <Plus size={12} weight="bold" />
                New
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </FloatingPanelFrame>

      <AnimatePresence>
        {browser && (
          <motion.div
            key={browser}
            role="dialog"
            aria-label={browser === "projects" ? "Project browser" : "Conversation browser"}
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.75 }}
            className="fixed left-1/2 top-[50px] z-popover w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-surface-border bg-surface-base shadow-2xl"
          >
            {browser === "projects" ? (
              <ProjectBrowser
                enabled={projectEnabled}
                projects={filteredProjects}
                query={projectQuery}
                currentProjectPath={currentProjectPath}
                onQueryChange={setProjectQuery}
                onSelectProject={(project) => {
                  if (!projectEnabled) return;
                  onSelectProject(project);
                  setBrowser(null);
                }}
                onOpenProjectFolder={() => {
                  if (!projectEnabled) return;
                  onOpenProjectFolder();
                  setBrowser(null);
                }}
                onRemoveProject={onRemoveProject}
                onDeleteProject={onDeleteProject}
                onSwitchLocal={() => onScopeChange("local")}
                onClose={() => setBrowser(null)}
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
                  setBrowser(null);
                }}
                onOpenConversationInSideChat={(id, title) => {
                  onOpenConversationInSideChat?.(id, title);
                  setBrowser(null);
                }}
                onOpenConversationInNewWindow={(id) => {
                  onOpenConversationInNewWindow?.(id);
                  setBrowser(null);
                }}
                onNewConversation={() => {
                  onNewConversation();
                  setBrowser(null);
                }}
                onDeleteConversation={onDeleteConversation}
                onStartEditTitle={onStartEditTitle}
                onSaveConvTitle={onSaveConvTitle}
                onCancelConvEdit={onCancelConvEdit}
                onEditTitleChange={onEditTitleChange}
                onClose={() => setBrowser(null)}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function BrowserHeader({
  title,
  subtitle,
  query,
  placeholder,
  onQueryChange,
  onClose,
}: {
  title: string;
  subtitle: string;
  query: string;
  placeholder: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="border-b border-surface-divider p-3">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-selected">
          <StudioMark size={16} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">{title}</p>
          <p className="text-xs leading-relaxed text-muted">{subtitle}</p>
        </div>
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-primary">
          <X size={13} weight="bold" />
        </button>
      </div>
      <label className="flex h-8 items-center gap-2 rounded-xl border border-surface-border bg-surface-page px-3 text-muted">
        <Search size={13} />
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
  onClose,
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
  onClose: () => void;
}) {
  return (
    <>
      <BrowserHeader
        title="Projects"
        subtitle={enabled ? "Local workspaces available on this machine." : "Local projects require the Local environment."}
        query={query}
        placeholder="Search projects"
        onQueryChange={onQueryChange}
        onClose={onClose}
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
              <Plus size={13} weight="bold" />
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
                        <X size={11} weight="bold" />
                      </button>
                      <button type="button" title="Delete Studio project data" onClick={(event) => { event.stopPropagation(); onDeleteProject(project.id); }} className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary">
                        <Trash size={11} weight="bold" />
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
  const [menuConvId, setMenuConvId] = useState<string | null>(null);

  return (
    <>
      <BrowserHeader
        title="Conversations"
        subtitle="Recent threads, filtered to the current environment and project when applicable."
        query={query}
        placeholder="Search conversations"
        onQueryChange={onQueryChange}
        onClose={onClose}
      />
      <div className="p-2">
        <button type="button" onClick={onNewConversation} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface-hover">
          <Plus size={13} weight="bold" />
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
            const menuOpen = menuConvId === conv.id;
            return (
              <div
                key={conv.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuConvId(conv.id);
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
                {!isClaudeOwned && editingConvId !== conv.id && (
                  <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                    <ConversationActionsButton
                      conv={conv}
                      isClaudeOwned={isClaudeOwned}
                      open={menuOpen}
                      onOpenChange={(open) => setMenuConvId(open ? conv.id : null)}
                      onSelectConversation={onSelectConversation}
                      onOpenConversationInSideChat={onOpenConversationInSideChat}
                      onOpenConversationInNewWindow={onOpenConversationInNewWindow}
                      onStartEditTitle={onStartEditTitle}
                      onDeleteConversation={onDeleteConversation}
                      onClose={onClose}
                    />
                  </div>
                )}
                {(isClaudeOwned || editingConvId === conv.id) && (
                  <div className="absolute right-2 top-2 hidden group-hover:flex">
                    <ConversationActionsButton
                      conv={conv}
                      isClaudeOwned={isClaudeOwned}
                      open={menuOpen}
                      onOpenChange={(open) => setMenuConvId(open ? conv.id : null)}
                      onSelectConversation={onSelectConversation}
                      onOpenConversationInSideChat={onOpenConversationInSideChat}
                      onOpenConversationInNewWindow={onOpenConversationInNewWindow}
                      onStartEditTitle={onStartEditTitle}
                      onDeleteConversation={onDeleteConversation}
                      onClose={onClose}
                    />
                  </div>
                )}
                {menuOpen && (
                  <ConversationActionsMenu
                    conv={conv}
                    isClaudeOwned={isClaudeOwned}
                    onSelectConversation={onSelectConversation}
                    onOpenConversationInSideChat={onOpenConversationInSideChat}
                    onOpenConversationInNewWindow={onOpenConversationInNewWindow}
                    onStartEditTitle={onStartEditTitle}
                    onDeleteConversation={onDeleteConversation}
                    onClose={() => setMenuConvId(null)}
                    onPanelClose={onClose}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function ConversationActionsButton({
  conv,
  isClaudeOwned,
  open,
  onOpenChange,
}: {
  conv: ConversationMetadata;
  isClaudeOwned: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectConversation: (id: string) => void;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onStartEditTitle: (id: string, title: string, e: React.MouseEvent) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  void conv;
  void isClaudeOwned;
  return (
    <button
      type="button"
      title="Conversation actions"
      onClick={(event) => {
        event.stopPropagation();
        onOpenChange(!open);
      }}
      className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
    >
      <DotsThree size={12} weight="bold" />
    </button>
  );
}

function ConversationActionsMenu({
  conv,
  isClaudeOwned,
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
  onSelectConversation: (id: string) => void;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onStartEditTitle: (id: string, title: string, e: React.MouseEvent) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onClose: () => void;
  onPanelClose: () => void;
}) {
  const itemClass = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-secondary hover:bg-surface-hover hover:text-primary";
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="absolute right-2 top-9 z-20 w-48 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
    >
      <button
        type="button"
        onClick={() => {
          onSelectConversation(conv.id);
          onClose();
          onPanelClose();
        }}
        className={itemClass}
      >
        <ChatCircle size={13} /> Open
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenConversationInSideChat?.(conv.id, conv.title);
          onClose();
        }}
        className={itemClass}
      >
        <SidebarSimple size={13} /> Open in Side Chat
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenConversationInNewWindow?.(conv.id);
          onClose();
        }}
        className={itemClass}
      >
        <Stack size={13} /> Open in New Window
      </button>
      {!isClaudeOwned && (
        <>
          <div className="my-1 h-px bg-surface-divider" />
          <button type="button" onClick={(event) => { onStartEditTitle(conv.id, conv.title, event); onClose(); }} className={itemClass}>
            <PencilSimple size={13} /> Rename
          </button>
          <button type="button" onClick={(event) => { onDeleteConversation(conv.id, event); onClose(); }} className={itemClass}>
            <Trash size={13} /> Delete
          </button>
        </>
      )}
    </motion.div>
  );
}
