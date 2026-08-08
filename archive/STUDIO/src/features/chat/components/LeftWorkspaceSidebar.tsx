import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Add, Back, Close, Edit, FolderOpen, Forward, More, Search } from "@/ui/icons";
import { useCommandPalette } from "@/app/contexts/CommandPaletteContext";
import { NavToggleIcon } from "@/ui/icons/WorkspaceIcons";
import { setLeftPanelWidth } from "@/app/shell/workspaceLayoutStore";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import { ConversationActionsMenu, ConversationRow, ProjectRow } from "./ChatFloatingDockRows";
import { normPath, useChatFloatingDockTree } from "./useChatFloatingDockTree";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";
import {
  WORKSPACE_PANEL_DEFAULT_WIDTH,
  clampWorkspacePanelWidth,
} from "@/features/workspace/rightWorkspace/workspacePanelGeometry";

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
  onRenameProject: (id: string, name: string) => void;
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
  onRenameProject,
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
  const query = "";
  const [workspaceWidth, setWorkspaceWidth] = useState(WORKSPACE_PANEL_DEFAULT_WIDTH);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [projectCreateMenuOpen, setProjectCreateMenuOpen] = useState(false);
  const [projectActionsMenuOpen, setProjectActionsMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const projectEnabled = scope === "local";
  const isSearching = false;

  const { treeData, allMatchingConversations } = useChatFloatingDockTree({
    conversations,
    projects,
    query,
    isSearching,
  });
  const currentProject = projects.find((project) => normPath(project.path) === normPath(currentProjectPath));

  useEffect(() => {
    if (!open || !currentProjectPath) return;
    const key = normPath(currentProjectPath);
    setExpandedProjects((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [open, currentProjectPath]);

  // Publish the panel's occupied width so fixed chrome (and the chat column)
  // can react to the push-layout, mirroring the right workspace signal.
  useEffect(() => {
    setLeftPanelWidth(open ? workspaceWidth : 0);
  }, [open, workspaceWidth]);
  useEffect(() => () => setLeftPanelWidth(0), []);
  useEffect(() => {
    const clampWidth = () => setWorkspaceWidth((current) => clampWorkspacePanelWidth(current));
    window.addEventListener("resize", clampWidth);
    return () => window.removeEventListener("resize", clampWidth);
  }, []);

  const toggleProject = (key: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const closePanel = () => onOpenChange(false);

  const startScratchProject = () => {
    onScopeChange("local");
    onNewConversation();
    setProjectCreateMenuOpen(false);
    closePanel();
  };

  const useExistingFolder = () => {
    if (!projectEnabled) onScopeChange("local");
    setProjectCreateMenuOpen(false);
    onOpenProjectFolder();
  };

  const renameProject = (project: ProjectEntry) => {
    const nextName = window.prompt("Rename project", project.name)?.trim();
    setProjectActionsMenuOpen(false);
    if (!nextName || nextName === project.name) return;
    onRenameProject(project.id, nextName);
  };

  const openProjectInExplorer = (project: ProjectEntry) => {
    setProjectActionsMenuOpen(false);
    import("@tauri-apps/plugin-opener")
      .then(({ openPath }) => openPath(project.path))
      .catch(() => {});
  };

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = workspaceWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (event: MouseEvent) => {
      setWorkspaceWidth(clampWorkspacePanelWidth(startW + (event.clientX - startX)));
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
  const navItem =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-primary hover:bg-surface-hover";
  const sectionLabel = "px-2.5 text-2xs font-medium text-muted";

  return (
    <>
      {/* Top-left fixed controls: sidebar toggle, search (cmd-k), and
          independent back/forward navigation icons. */}
      <div
        className="pointer-events-auto fixed top-0 z-toast flex h-[var(--studio-topbar-height)] items-center gap-1 px-1"
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
            layout
            key="left-workspace-sidebar"
            role="dialog"
            aria-label="Conversations and projects sidebar"
            initial={{ width: 0 }}
            animate={{ width: workspaceWidth }}
            exit={{ width: 0 }}
            transition={{
              width: { duration: reduceMotion ? 0 : 0.24, ease: EASE },
              layout: { duration: reduceMotion ? 0 : 0.28, ease: EASE },
            }}
            className="h-full flex-shrink-0 overflow-hidden"
          >
            <div className="flex h-full transition-colors duration-300" style={{ width: workspaceWidth, minWidth: workspaceWidth }}>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-page shadow-none">
                <div className="flex items-center justify-between px-3 pb-2 pt-3">
                  <button
                    type="button"
                    onClick={closePanel}
                    className="min-w-0 truncate text-left text-sm font-semibold text-primary"
                    title="Studio"
                  >
                    Studio
                  </button>
                  <div className="flex items-center gap-0.5">
                    <IconButton
                      aria-label="Search"
                      title="Search"
                      onClick={() => openCommandPalette(true)}
                      className="h-7 w-7 rounded-lg text-muted hover:bg-surface-hover hover:text-primary"
                    >
                      <Search size="sm" />
                    </IconButton>
                    <IconButton
                      aria-label="Close sidebar"
                      title="Close sidebar"
                      onClick={closePanel}
                      className="h-7 w-7 rounded-lg text-muted hover:bg-surface-hover hover:text-primary"
                    >
                      <Close size="sm" />
                    </IconButton>
                  </div>
                </div>

                <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1 scrollbar-auto-hide">
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
                      <section className="space-y-0.5">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            onNewConversation();
                            closePanel();
                          }}
                          className={navItem}
                        >
                          <Edit size="sm" />
                          New chat
                        </Button>
                      </section>

                      {/* Row 2 — Projects */}
                      <section className="mt-6">
                        <div className="relative flex items-center justify-between pb-1">
                          <p className={sectionLabel}>Projects</p>
                          <div className="flex items-center gap-0.5 pr-1">
                            <IconButton
                              aria-label="Project options"
                              title="Project options"
                              onClick={() => {
                                setProjectCreateMenuOpen(false);
                                setProjectActionsMenuOpen((value) => !value);
                              }}
                              className="h-6 w-6 rounded-md text-muted hover:bg-surface-hover hover:text-primary"
                            >
                              <More size="sm" />
                            </IconButton>
                            <IconButton
                              aria-label="New project"
                              title="New project"
                              onClick={() => {
                                setProjectActionsMenuOpen(false);
                                setProjectCreateMenuOpen((value) => !value);
                              }}
                              className="h-6 w-6 rounded-md text-muted hover:bg-surface-hover hover:text-primary"
                            >
                              <Add size="sm" />
                            </IconButton>
                          </div>
                          <AnimatePresence>
                            {projectActionsMenuOpen && (
                              <>
                                <button
                                  type="button"
                                  aria-label="Close project actions"
                                  className="fixed inset-0 z-context cursor-default"
                                  onMouseDown={() => setProjectActionsMenuOpen(false)}
                                />
                                <motion.div
                                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                  transition={{ duration: 0.12, ease: "easeOut" }}
                                  className="absolute right-8 top-7 z-context w-48 rounded-xl border border-surface-border bg-surface-page p-1.5 shadow-lg"
                                >
                                  {currentProject ? (
                                    <>
                                      <Button variant="ghost" onClick={() => openProjectInExplorer(currentProject)} className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-surface-hover">
                                        <FolderOpen size="sm" />
                                        Open in Explorer
                                      </Button>
                                      <Button variant="ghost" onClick={() => renameProject(currentProject)} className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-surface-hover">
                                        <Edit size="sm" />
                                        Rename Project
                                      </Button>
                                      <Button variant="ghost" onClick={() => { onRemoveProject(currentProject.id); setProjectActionsMenuOpen(false); }} className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-surface-hover">
                                        <Close size="sm" />
                                        Remove
                                      </Button>
                                    </>
                                  ) : (
                                    <div className="px-2.5 py-2 text-xs text-muted">No project selected</div>
                                  )}
                                </motion.div>
                              </>
                            )}
                            {projectCreateMenuOpen && (
                              <>
                                <button
                                  type="button"
                                  aria-label="Close project menu"
                                  className="fixed inset-0 z-context cursor-default"
                                  onMouseDown={() => setProjectCreateMenuOpen(false)}
                                />
                                <motion.div
                                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                                  transition={{ duration: 0.12, ease: "easeOut" }}
                                  className="absolute right-1 top-7 z-context w-52 rounded-xl border border-surface-border bg-surface-page p-1.5 shadow-lg"
                                >
                                  <Button variant="ghost" onClick={startScratchProject} className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-surface-hover">
                                    <Add size="sm" />
                                    Start from scratch
                                  </Button>
                                  <Button variant="ghost" onClick={useExistingFolder} className="w-full justify-start gap-2 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-surface-hover">
                                    <FolderOpen size="sm" />
                                    Use an existing folder
                                  </Button>
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>
                        {!projectEnabled ? (
                          <div className="px-2.5 py-1 text-xs text-muted">Switch to Local to browse projects.</div>
                        ) : treeData.projectList.length === 0 ? (
                          <div className="px-2.5 py-1 text-xs text-muted">No projects</div>
                        ) : (
                          <div className="space-y-0.5">
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
                                    onRemove={() => group.project && onRemoveProject(group.project.id)}
                                    onRename={(name) => group.project && onRenameProject(group.project.id, name)}
                                    onOpenInExplorer={() => group.project && openProjectInExplorer(group.project)}
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

                      <section className="mt-6">
                        <div className="flex items-center justify-between pb-1">
                          <p className={sectionLabel}>Chats</p>
                          {conversations.length > 0 && (
                            <span className="pr-2 text-2xs text-muted">{conversations.length}</span>
                          )}
                        </div>
                        {conversations.length === 0 ? (
                          <div className="px-2.5 py-1 text-xs text-muted">No chats</div>
                        ) : (
                          <div className="space-y-0.5">{conversations.map(renderItem)}</div>
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
              <ResizeHandle onMouseDown={onResizeDown} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
