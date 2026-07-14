import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Add,
  Close,
  Expand,
  FolderOpen,
  Message,
} from "@/ui/icons";
import {
  FloatingPanelFrame,
  FloatingPanelNavigation,
} from "@/app/shell/FloatingPanel";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { SearchInput } from "@/ui/primitives";
import { useNavigation } from "@/app/contexts/NavigationContext";
import { StudioMark } from "@/ui/brand";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import { ConversationActionsMenu, ConversationRow, ProjectRow } from "./ChatFloatingDockRows";
import { normPath, useChatFloatingDockTree } from "./useChatFloatingDockTree";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
const EASE = [0.16, 1, 0.3, 1] as const;

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
        {/* Single persistent wrapper - the `layout` spring morphs the dock
            width when content changes, so it reads as one continuous dock
            resizing rather than two separate docks swapping in/out. */}
        <motion.div layout className="flex items-center gap-1">
          {/* Always-present brand mark - toggles between nav and conversation
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
                      <FolderOpen size="sm" weight="fill" className="flex-shrink-0 text-secondary" />
                      <span className="max-w-[110px] flex-shrink-0 truncate text-secondary">{projectName}</span>
                      <span className="flex-shrink-0 text-muted">/</span>
                    </>
                  ) : (
                    <Message size="sm" weight={currentConvId ? "fill" : undefined} className="flex-shrink-0 text-secondary" />
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
                    <Expand size="xs" className={`transition-transform ${browserOpen ? "rotate-180" : ""}`} />
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
                  <Message size="sm" weight={currentConvId ? "fill" : undefined} />
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
  const { treeData, allMatchingConversations } = useChatFloatingDockTree({
    conversations,
    projects,
    query,
    isSearching,
  });

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
          <div className="flex-1">
            <SearchInput
              value={query}
              onValueChange={onQueryChange}
              aria-label="Search conversations and projects"
              placeholder="Search conversations and projects"
              size="md"
              className="rounded-xl bg-surface-page text-xs"
            />
          </div>
          <IconButton
            aria-label="Close"
            onClick={onClose}
            className="flex-shrink-0 rounded-full text-muted hover:bg-surface-hover hover:text-primary"
          >
            <Close size="sm" />
          </IconButton>
        </div>
        {/* Two distinct entry points: start a conversation vs open a project folder */}
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="ghost"
            onClick={onNewConversation}
            className="flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-page py-2 text-xs font-medium text-primary hover:bg-surface-hover"
          >
            <Message size="sm" />
            New conversation
          </Button>
          <Button
            variant="ghost"
            onClick={onOpenProjectFolder}
            disabled={!projectEnabled}
            title={projectEnabled ? "Open a folder as a project" : "Switch to Local to open a project"}
            className="flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-page py-2 text-xs font-medium text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen size="sm" />
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
                  <Add size="xs" />
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
