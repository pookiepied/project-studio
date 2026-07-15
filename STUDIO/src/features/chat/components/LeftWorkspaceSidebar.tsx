import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Add, Back, Close, FolderOpen, Forward, Message, Search } from "@/ui/icons";
import { useCommandPalette } from "@/app/contexts/CommandPaletteContext";
import { NavToggleIcon } from "@/ui/icons/WorkspaceIcons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { SearchInput } from "@/ui/primitives";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ProjectEntry } from "@/core/projects";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import { ConversationActionsMenu, ConversationRow, ProjectRow } from "./ChatFloatingDockRows";
import { normPath, useChatFloatingDockTree } from "./useChatFloatingDockTree";

const EASE = [0.16, 1, 0.3, 1] as const;

const CommandIcon = ({ size = 11 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  </svg>
);

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
  const [query, setQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [activeSection, setActiveSection] = useState<"conversations" | "projects">("conversations");
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

  return (
    <>
      <div
        className="pointer-events-auto fixed top-[9px] z-toast flex h-7 items-center gap-1.5"
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
          aria-label="Search or jump to (Ctrl+K)"
          title="Search or jump to (Ctrl+K)"
          className="studio-chat-icon-button flex h-7 items-center gap-1.5 rounded-lg px-2 text-disabled transition-colors duration-100 hover:bg-surface-base hover:text-secondary dark:text-secondary dark:hover:bg-surface-raised dark:hover:text-disabled"
        >
          <Search size="sm" />
          <kbd className="flex items-center gap-0.5 rounded border border-surface-border/70 px-1 py-0.5 font-sans text-3xs leading-none">
            <CommandIcon size={10} />
            K
          </kbd>
        </IconButton>
        <div className="flex items-center gap-0.5 rounded-lg border border-surface-border/70 bg-surface-page/80 p-0.5">
          <IconButton
            size="sm"
            onClick={() => window.history.back()}
            aria-label="Go back"
            title="Go back"
            className="studio-chat-icon-button flex h-6 w-6 items-center justify-center rounded-md text-disabled transition-colors hover:bg-surface-hover hover:text-secondary"
          >
            <Back size="xs" />
          </IconButton>
          <IconButton
            size="sm"
            onClick={() => window.history.forward()}
            aria-label="Go forward"
            title="Go forward"
            className="studio-chat-icon-button flex h-6 w-6 items-center justify-center rounded-md text-disabled transition-colors hover:bg-surface-hover hover:text-secondary"
          >
            <Forward size="xs" />
          </IconButton>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.aside
            key="left-workspace-sidebar"
            role="dialog"
            aria-label="Conversations and projects sidebar"
            initial={{ opacity: 0, x: -330 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -330 }}
            transition={{ type: "spring", stiffness: 430, damping: 36, mass: 0.8 }}
            className="fixed bottom-0 left-0 top-[46px] z-popover flex w-[330px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-r-2xl border-y border-r border-surface-border bg-surface-base shadow-2xl"
          >
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
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-surface-page p-1">
                {([
                  ["conversations", "Conversations"],
                  ["projects", "Projects"],
                ] as const).map(([id, label]) => (
                  <Button
                    key={id}
                    variant="ghost"
                    onClick={() => setActiveSection(id)}
                    className={`h-8 justify-center rounded-lg px-2 text-xs font-medium transition-colors ${
                      activeSection === id
                        ? "bg-surface-selected text-primary"
                        : "text-muted hover:bg-surface-hover hover:text-primary"
                    }`}
                  >
                    {label}
                  </Button>
                ))}
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
              {!projectEnabled && !isSearching && activeSection === "projects" && (
                <div className="mb-2 rounded-xl border border-surface-border bg-surface-page p-3">
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
              )}

              {isSearching ? (
                allMatchingConversations.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-primary">Nothing found</p>
                    <p className="mt-1 text-xs text-muted">Try another search.</p>
                  </div>
                ) : (
                  allMatchingConversations.map(renderItem)
                )
              ) : activeSection === "conversations" ? (
                conversations.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-primary">No conversations yet</p>
                    <p className="mt-1 text-xs text-muted">Start a chat to fill this section.</p>
                  </div>
                ) : (
                  <div>
                    <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                      Conversations
                    </p>
                    {conversations.map(renderItem)}
                  </div>
                )
              ) : treeData.projectList.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-primary">No projects yet</p>
                  <p className="mt-1 text-xs text-muted">Add a project folder to organize related chats.</p>
                </div>
              ) : (
                <div>
                  <p className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                    Projects
                  </p>
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
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
