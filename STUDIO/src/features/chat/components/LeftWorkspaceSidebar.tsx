import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Add, Back, Close, FolderOpen, Forward, Message, Search } from "@/ui/icons";
import { useCommandPalette } from "@/app/contexts/CommandPaletteContext";
import { NavToggleIcon } from "@/ui/icons/WorkspaceIcons";
import { setLeftPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { SearchInput } from "@/ui/primitives";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import { ConversationActionsMenu, ConversationRow, ProjectRow } from "./ChatFloatingDockRows";
import { normPath, useChatFloatingDockTree } from "./useChatFloatingDockTree";

const PANEL_WIDTH = 320;
const EASE = [0.32, 0.72, 0, 1] as const;

interface LeftWorkspaceSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ConversationStorageScope;
  onScopeChange: (scope: ConversationStorageScope) => void;
  projects: ProjectEntry[];
  currentProjectPath?: string;
  conversations: ConversationMetadata[];
  currentConvId?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  onSelectProject: (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectConversation: (id: string) => void | Promise<void>;
  onOpenConversationInSideChat?: (id: string, title?: string) => void;
  onOpenConversationInNewWindow?: (id: string) => void;
  onNewConversation: () => void;
  onStartEditTitle: (id: string, title: string, event: React.MouseEvent) => void;
  onDeleteConversation: (id: string, event: React.MouseEvent) => void;
  editingConvId: string | null;
  editingConvTitle: string;
  onEditTitleChange: (value: string) => void;
  onSaveConvTitle: (id: string) => void;
  onCancelConvEdit: () => void;
}

export function LeftWorkspaceSidebar({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  projects,
  currentProjectPath,
  conversations,
  currentConvId,
  conversationStatuses,
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
}: LeftWorkspaceSidebarProps) {
  const { setOpen: openCommandPalette } = useCommandPalette();
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const projectEnabled = scope === "local";
  const isSearching = query.trim().length > 0;

  const { treeData, allMatchingConversations } = useChatFloatingDockTree({
    conversations,
    projects,
    query,
    isSearching,
  });

  useEffect(() => {
    if (!open || !currentProjectPath) return;
    const key = normPath(currentProjectPath);
    setExpandedProjects((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [open, currentProjectPath]);

  // Publish the panel's occupied width so fixed chrome (and the chat column)
  // can react to the push-layout, mirroring the right workspace signal.
  useEffect(() => {
    setLeftPanelWidth(open ? PANEL_WIDTH : 0);
  }, [open]);
  useEffect(() => () => setLeftPanelWidth(0), []);

  const toggleProject = (key: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const closePanel = () => onOpenChange(false);

  const renderItem = (conv: ConversationMetadata) => (
    <ConversationRow
      key={conv.id}
      conv={conv}
      currentConvId={currentConvId}
      conversationStatuses={conversationStatuses}
      editingConvId={editingConvId}
      editingConvTitle={editingConvTitle}
      onSelectConversation={(id) => {
        void onSelectConversation(id);
        closePanel();
      }}
      onSaveConvTitle={onSaveConvTitle}
      onCancelConvEdit={onCancelConvEdit}
      onEditTitleChange={onEditTitleChange}
      onOpenMenu={(rect) => setMenu({ id: conv.id, top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })}
      menuOpen={menu?.id === conv.id}
      onCloseMenu={() => setMenu(null)}
    />
  );

  const iconBtn =
    "studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg text-disabled transition-colors duration-100 hover:bg-surface-base hover:text-secondary dark:text-secondary dark:hover:bg-surface-raised dark:hover:text-disabled";

  return (
    <>
      {/* Top-left fixed controls: sidebar toggle, search (cmd-k), and
          independent back/forward navigation icons. */}
      <div
        className="pointer-events-auto fixed top-[9px] z-toast flex h-7 items-center gap-1"
        style={{ left: 72 }}
      >
        <IconButton
          size="sm"
          onClick={() => onOpenChange(!open)}
          aria-label={open ? "Hide sidebar" : "Show sidebar"}
          title={open ? "Hide sidebar" : "Show sidebar"}
          className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-100 ${
            open
              ? "bg-surface-base text-secondary dark:bg-surface-raised dark:text-disabled"
              : "text-disabled hover:bg-surface-base hover:text-secondary dark:text-secondary dark:hover:bg-surface-raised dark:hover:text-disabled"
          }`}
        >
          <NavToggleIcon size={14} open={open} />
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => openCommandPalette(true)}
          aria-label="Search (Ctrl+K)"
          title="Search"
          className={iconBtn}
        >
          <Search size="sm" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => window.history.back()}
          aria-label="Go back"
          title="Go back"
          className={iconBtn}
        >
          <Back size="xs" />
        </IconButton>
        <IconButton
          size="sm"
          onClick={() => window.history.forward()}
          aria-label="Go forward"
          title="Go forward"
          className={iconBtn}
        >
          <Forward size="xs" />
        </IconButton>
      </div>

      {/* Push-layout panel — a flex child that animates its own width so it
          reflows (pushes) the chat column, mirroring the right workspace. */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="left-workspace-sidebar"
            role="dialog"
            aria-label="Conversations and projects sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PANEL_WIDTH, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{
              width: { duration: reduceMotion ? 0 : 0.24, ease: EASE },
              opacity: { duration: reduceMotion ? 0 : 0.16, ease: "easeOut" },
            }}
            className="h-full flex-shrink-0 overflow-hidden"
          >
            <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH, minWidth: PANEL_WIDTH }}>
              {/* Reserve the top chrome strip so the macOS-style traffic lights
                  (and the fixed control cluster) stay clear of the panel card. */}
              <div className="h-[46px] flex-shrink-0" />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tr-2xl rounded-br-2xl border-r border-surface-border bg-surface-base shadow-xl">
                <div className="border-b border-surface-divider p-2">
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <SearchInput
                        value={query}
                        onValueChange={setQuery}
                        aria-label="Search conversations and projects"
                        placeholder="Search"
                        size="md"
                        className="rounded-xl bg-surface-page text-xs"
                      />
                    </div>
                    <IconButton
                      aria-label="Close sidebar"
                      onClick={closePanel}
                      className="h-8 w-8 flex-shrink-0 rounded-full text-muted hover:bg-surface-hover hover:text-primary"
                    >
                      <Close size="sm" />
                    </IconButton>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        onNewConversation();
                        closePanel();
                      }}
                      className="flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-page py-2 text-xs font-medium text-primary hover:bg-surface-hover"
                    >
                      <Message size="sm" />
                      New chat
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (!projectEnabled) {
                          onScopeChange("local");
                          return;
                        }
                        onOpenProjectFolder();
                      }}
                      title={projectEnabled ? "Open a folder as a project" : "Switch to Local to add a project"}
                      className="flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-page py-2 text-xs font-medium text-primary hover:bg-surface-hover"
                    >
                      <FolderOpen size="sm" />
                      Add project
                    </Button>
                  </div>
                </div>

                <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-auto-hide">
                  {isSearching ? (
                    allMatchingConversations.length === 0 ? (
                      <div className="px-4 py-10 text-center">
                        <p className="text-sm font-medium text-primary">Nothing found</p>
                        <p className="mt-1 text-xs text-muted">Try another search.</p>
                      </div>
                    ) : (
                      <div>
                        <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                          Results
                        </p>
                        {allMatchingConversations.map(renderItem)}
                      </div>
                    )
                  ) : (
                    <>
                      {/* Row 1 — Conversations */}
                      <section>
                        <div className="flex items-center justify-between px-3 pb-1 pt-1">
                          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                            Conversations
                          </p>
                          {conversations.length > 0 && (
                            <span className="text-2xs text-muted">{conversations.length}</span>
                          )}
                        </div>
                        {conversations.length === 0 ? (
                          <div className="px-4 py-6 text-center">
                            <p className="text-xs text-muted">No conversations yet.</p>
                          </div>
                        ) : (
                          conversations.map(renderItem)
                        )}
                      </section>

                      {/* Row 2 — Projects */}
                      <section className="mt-3">
                        <div className="flex items-center justify-between px-3 pb-1 pt-1">
                          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                            Projects
                          </p>
                          {projectEnabled && treeData.projectList.length > 0 && (
                            <span className="text-2xs text-muted">{treeData.projectList.length}</span>
                          )}
                        </div>
                        {!projectEnabled ? (
                          <div className="rounded-xl border border-surface-border bg-surface-page p-3">
                            <p className="text-xs font-semibold text-primary">Cloud environment is active</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted">
                              Project folders live on this computer. Switch to Local to add or browse projects.
                            </p>
                            <Button
                              variant="ghost"
                              onClick={() => onScopeChange("local")}
                              className="mt-2 rounded-full bg-surface-selected px-3 py-1.5 text-xs font-medium text-primary hover:bg-surface-hover"
                            >
                              Switch to Local
                            </Button>
                          </div>
                        ) : treeData.projectList.length === 0 ? (
                          <div className="px-4 py-6 text-center">
                            <p className="text-xs text-muted">No projects yet.</p>
                          </div>
                        ) : (
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
                                    onToggle={() => toggleProject(key)}
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
                                                closePanel();
                                              }}
                                              className="mx-3 my-1 w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-primary"
                                            >
                                              <Add size="xs" />
                                              Start chat in this project
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
                      </section>
                    </>
                  )}
                </div>

                {menu && (() => {
                  const conv = allMatchingConversations.find((item) => item.id === menu.id)
                    ?? conversations.find((item) => item.id === menu.id);
                  if (!conv) return null;
                  return (
                    <ConversationActionsMenu
                      conv={conv}
                      isClaudeOwned={conv.owner === "claude"}
                      isCurrent={conv.id === currentConvId}
                      pos={{ top: menu.top, right: menu.right }}
                      onSelectConversation={(id) => { void onSelectConversation(id); }}
                      onOpenConversationInSideChat={onOpenConversationInSideChat}
                      onOpenConversationInNewWindow={onOpenConversationInNewWindow}
                      onStartEditTitle={onStartEditTitle}
                      onDeleteConversation={onDeleteConversation}
                      onClose={() => setMenu(null)}
                      onPanelClose={closePanel}
                    />
                  );
                })()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
