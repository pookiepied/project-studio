import { useState, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DotsThreeIcon as DotsThree,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  TerminalIcon as Terminal,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";
import { OverviewIcon } from "@/ui/icons/WorkspaceIcons";
import { ConversationsDropdown } from "./ConversationsDropdown";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import type { ProjectEntry } from "@/core/projects";

interface ChatHeaderProps {
  // Title
  conversationTitle: string | undefined;
  // Active project folder name — shown grayed before the title ("folder / TITLE")
  projectName?:      string;
  // Tauri flag (controls Tools menu contents)
  isTauri:           boolean;
  // Summary panel toggle
  summaryPanelOpen:    boolean;
  onToggleSummaryPanel: () => void;
  // Terminal (spawned from Tools dropdown)
  terminalOpen:      boolean;
  onToggleTerminal:  () => void;
  // Conv options menu
  showConvMenu:      boolean;
  onToggleConvMenu:  () => void;
  onCloseConvMenu:   () => void;
  onRenameChat:      () => void;
  onNewChat:         () => void;
  // Conversations dropdown (all props forwarded)
  conversations:       ConversationMetadata[];
  currentConvId:       string | undefined;
  showConversations:   boolean;
  editingConvId:       string | null;
  editingConvTitle:    string;
  hoveredConvId:       string | null;
  onToggleConversations: () => void;
  onCloseConversations:  () => void;
  onSelectConversation:(id: string) => void;
  onNewConversation:   () => void;
  onDeleteConversation:(id: string, e: React.MouseEvent) => void;
  onStartEditTitle:    (id: string, title: string, e: React.MouseEvent) => void;
  onSaveConvTitle:     (id: string) => void;
  onCancelConvEdit:    () => void;
  onEditTitleChange:   (v: string) => void;
  onHoverConv:           (id: string | null) => void;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  // Projects (forwarded to the projects/conversations switcher)
  projects:            ProjectEntry[];
  currentProjectPath?: string;
  onSelectProject:     (project: ProjectEntry) => void;
  onOpenProjectFolder: () => void;
  onRemoveProject:     (id: string) => void;
  onDeleteProject:     (id: string) => void;
  /** Navigation trigger rendered at the head of the left zone (replaces the dock). */
  navTrigger?: ReactNode;
  /** Branch / worktree / context-window — project state, so it sits beside the title. */
  contextControls?: ReactNode;
  accountControl?: ReactNode;
  rightControls?: ReactNode;
}

// ---------------------------------------------------------------------------
// Tools dropdown
// ---------------------------------------------------------------------------

interface ToolsDropdownProps {
  isTauri:         boolean;
  terminalOpen:    boolean;
  onToggleTerminal: () => void;
  onClose:         () => void;
}

function ToolsDropdown({ isTauri, terminalOpen, onToggleTerminal, onClose }: ToolsDropdownProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{ transformOrigin: "top right" }}
      className="absolute top-full right-0 mt-1.5 w-44 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-xl shadow-lg overflow-hidden z-50"
    >
      <div className="p-1">
        {isTauri && (
          <button
            type="button"
            onClick={() => { onClose(); onToggleTerminal(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors duration-100 text-left ${
              terminalOpen
                ? "bg-gray-100 dark:bg-surface-selected text-gray-700 dark:text-gray-300"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-selected"
            }`}
          >
            <Terminal size={12} weight="regular" className="flex-shrink-0" />
            <span>Terminal</span>
            {terminalOpen && (
              <span className="ml-auto text-2xs text-gray-400 dark:text-gray-500">open</span>
            )}
          </button>
        )}
        {!isTauri && (
          <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-600 leading-relaxed">
            Tools available in the desktop app.
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tools button
// ---------------------------------------------------------------------------

interface ToolsButtonProps {
  isTauri:         boolean;
  terminalOpen:    boolean;
  onToggleTerminal: () => void;
}

function ToolsButton({ isTauri, terminalOpen, onToggleTerminal }: ToolsButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false), open);

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Tools"
        className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-smooth ${
          open || terminalOpen
            ? "bg-gray-100 dark:bg-surface-raised text-gray-700 dark:text-gray-300"
            : "text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-raised hover:text-gray-600 dark:hover:text-gray-400"
        }`}
      >
        <Wrench size={14} weight={terminalOpen ? "fill" : "regular"} />
      </button>

      <AnimatePresence>
        {open && (
          <ToolsDropdown
            isTauri={isTauri}
            terminalOpen={terminalOpen}
            onToggleTerminal={onToggleTerminal}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatHeader
// ---------------------------------------------------------------------------

export const ChatHeader = ({
  conversationTitle,
  projectName,
  isTauri,
  summaryPanelOpen,
  onToggleSummaryPanel,
  terminalOpen,
  onToggleTerminal,
  showConvMenu,
  onToggleConvMenu,
  onCloseConvMenu,
  onRenameChat,
  onNewChat,
  conversations,
  currentConvId,
  showConversations,
  editingConvId,
  editingConvTitle,
  hoveredConvId,
  onToggleConversations,
  onCloseConversations,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onStartEditTitle,
  onSaveConvTitle,
  onCancelConvEdit,
  onEditTitleChange,
  onHoverConv,
  conversationStatuses,
  projects,
  currentProjectPath,
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
  navTrigger,
  contextControls,
  accountControl,
  rightControls,
}: ChatHeaderProps) => {
  const convMenuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(convMenuRef, onCloseConvMenu, showConvMenu);

  // The centered work identity: PROJECT / TITLE, feeding the switcher trigger.
  const titleLabel = (
    <span className="text-xs font-semibold tracking-extra-wide font-sans text-gray-400 dark:text-gray-600">
      {projectName && (
        <>
          <span className="font-normal text-gray-300 dark:text-gray-700">{projectName.toUpperCase()}</span>
          <span className="mx-1 text-gray-300 dark:text-gray-700">/</span>
        </>
      )}
      {conversationTitle?.toUpperCase() ?? "NEW CHAT"}
    </span>
  );

  return (
    // Three zones, each with one owner: left = navigation, center = this work,
    // right = system + panels. Grid so the center is truly centered regardless
    // of how wide the side zones get.
    <div className="studio-chat-header flex-shrink-0 px-[3px] py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-w-0">
      {/* Left: navigation only */}
      <div className="studio-chat-left-zone flex items-center gap-1 min-w-0 justify-self-start">
        {navTrigger}
      </div>

      {/* Center: the work identity — switcher (title), branch/worktree, context,
          all in one pill. Clicking the title opens the projects/conversations
          switcher; branch and context are their own controls inside the pill. */}
      <div className="studio-chat-center-zone group/header flex min-w-0 items-center justify-self-center">
        <div className="flex h-8 min-w-0 items-center gap-0.5 rounded-full border border-surface-border bg-surface-base/60 pl-1 pr-1">
          <ConversationsDropdown
            label={titleLabel}
            conversations={conversations}
            currentConvId={currentConvId}
            showConversations={showConversations}
            editingConvId={editingConvId}
            editingConvTitle={editingConvTitle}
            hoveredConvId={hoveredConvId}
            projects={projects}
            currentProjectPath={currentProjectPath}
            onSelectProject={onSelectProject}
            onOpenProjectFolder={onOpenProjectFolder}
            onRemoveProject={onRemoveProject}
            onDeleteProject={onDeleteProject}
            onToggle={onToggleConversations}
            onClose={onCloseConversations}
            onSelectConversation={onSelectConversation}
            onNewConversation={onNewConversation}
            onDeleteConversation={onDeleteConversation}
            onStartEditTitle={onStartEditTitle}
            onSaveConvTitle={onSaveConvTitle}
            onCancelConvEdit={onCancelConvEdit}
            onEditTitleChange={onEditTitleChange}
            onHoverConv={onHoverConv}
            conversationStatuses={conversationStatuses}
          />

          {contextControls && (
            <>
              <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-surface-divider" />
              {contextControls}
            </>
          )}

          {/* Chat options — rename / new chat for the current conversation. */}
          <div className="relative flex-shrink-0" ref={convMenuRef}>
            <button
              type="button"
              onClick={onToggleConvMenu}
              title="Chat options"
              className={`studio-chat-icon-button flex h-6 w-6 items-center justify-center rounded-md transition-smooth ${
                showConvMenu
                  ? "bg-gray-100 dark:bg-surface-raised text-gray-600 dark:text-gray-400"
                  : "text-gray-400 dark:text-gray-600 opacity-0 group-hover/header:opacity-100 hover:bg-gray-100 dark:hover:bg-surface-raised"
              }`}
            >
              <DotsThree size={13} weight="bold" />
            </button>

            <AnimatePresence>
              {showConvMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                  style={{ transformOrigin: "top right" }}
                  className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-xl shadow-lg overflow-hidden z-50"
                >
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => { onCloseConvMenu(); onRenameChat(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-selected rounded-lg transition-colors duration-100 text-left"
                    >
                      <PencilSimple size={12} weight="regular" className="flex-shrink-0" />
                      <span>Rename</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { onCloseConvMenu(); onNewChat(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-selected rounded-lg transition-colors duration-100 text-left"
                    >
                      <Plus size={12} weight="regular" className="flex-shrink-0" />
                      <span>New chat</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Right: system controls — environment, notifications, theme, panels. */}
      <div className="studio-chat-right-zone flex items-center gap-1.5 flex-shrink-0 justify-self-end">
        {accountControl}
        {rightControls ?? (
        <>
        {/* Overview panel toggle — active state is signalled by colour/bg only,
            the icon shape stays identical so it doesn't morph on click */}
        <button
          type="button"
          onClick={onToggleSummaryPanel}
          title={summaryPanelOpen ? "Hide overview" : "Show overview"}
          className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-smooth ${
            summaryPanelOpen
              ? "bg-gray-100 dark:bg-surface-raised text-gray-700 dark:text-gray-300"
              : "text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-raised hover:text-gray-600 dark:hover:text-gray-400"
          }`}
        >
          <OverviewIcon size={14} filled={false} />
        </button>

        {/* Tools dropdown */}
        <ToolsButton
          isTauri={isTauri}
          terminalOpen={terminalOpen}
          onToggleTerminal={onToggleTerminal}
        />
        </>
        )}
      </div>
    </div>
  );
};
