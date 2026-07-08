import { useState, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DotsThreeIcon as DotsThree,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  TerminalIcon as Terminal,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { OverviewIcon } from "@/components/icons/WorkspaceIcons";
import { ConversationsDropdown } from "./ConversationsDropdown";
import type { ConversationMetadata } from "@/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/services/conversations/backgroundSessionTracker";
import type { ConversationStorageScope } from "@/services/storage/chatHistoryService";

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
  storageScope:        ConversationStorageScope;
  currentConvId:       string | undefined;
  showConversations:   boolean;
  editingConvId:       string | null;
  editingConvTitle:    string;
  hoveredConvId:       string | null;
  onToggleConversations: () => void;
  onStorageScopeChange?: (scope: ConversationStorageScope) => void;
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
  storageScope,
  currentConvId,
  showConversations,
  editingConvId,
  editingConvTitle,
  hoveredConvId,
  onToggleConversations,
  onStorageScopeChange,
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
  accountControl,
  rightControls,
}: ChatHeaderProps) => {
  const convMenuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(convMenuRef, onCloseConvMenu, showConvMenu);

  return (
    <div className="studio-chat-header flex-shrink-0 px-[3px] py-3 flex items-center justify-between min-w-0">
      <div className="studio-chat-left-zone flex items-center gap-1 min-w-0 flex-1">
        <ConversationsDropdown
          conversations={conversations}
          storageScope={storageScope}
          currentConvId={currentConvId}
          showConversations={showConversations}
          editingConvId={editingConvId}
          editingConvTitle={editingConvTitle}
          hoveredConvId={hoveredConvId}
          onToggle={onToggleConversations}
          onStorageScopeChange={onStorageScopeChange}
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

        {/* Title + ⋯ options */}
        <div className="studio-chat-title-zone flex items-center gap-0.5 min-w-0 flex-1 group/header">
          {/* min-w-0 + inner truncating span — the h2 is a flex row (for h-7
              centering), so text-overflow only works on the inner span. This keeps
              a long "PROJECT / TITLE" clipped with an ellipsis instead of running
              under the center dock. */}
          <h2 className="studio-chat-inline-title flex h-7 min-w-0 items-center rounded-lg px-1.5 text-xs font-semibold text-gray-400 dark:text-gray-600 tracking-extra-wide font-sans transition-colors duration-300">
            <span className="min-w-0 truncate">
              {projectName && (
                <>
                  <span className="font-normal text-gray-300 dark:text-gray-700">
                    {projectName.toUpperCase()}
                  </span>
                  <span className="mx-1 text-gray-300 dark:text-gray-700">/</span>
                </>
              )}
              {conversationTitle?.toUpperCase() ?? "NEW CHAT"}
            </span>
          </h2>

          <div className="relative flex-shrink-0" ref={convMenuRef}>
            <button
              type="button"
              onClick={onToggleConvMenu}
              title="Chat options"
              className={`studio-chat-icon-button flex h-7 w-7 items-center justify-center rounded-lg transition-smooth opacity-0 group-hover/header:opacity-100 ${
                showConvMenu
                  ? "opacity-100 bg-gray-100 dark:bg-surface-raised text-gray-600 dark:text-gray-400"
                  : "text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-raised"
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
                  style={{ transformOrigin: "top left" }}
                  className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-surface-raised border border-gray-200 dark:border-surface-border rounded-xl shadow-lg overflow-hidden z-50"
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

      {/* Right: Summary panel toggle + Tools */}
      <div className="studio-chat-right-zone flex items-center gap-1.5 flex-shrink-0">
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
