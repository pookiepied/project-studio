import { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChatCircleIcon as ChatCircle,
  PencilSimpleIcon as PencilSimple,
  TrashIcon as Trash,
  CheckIcon as Check,
  XIcon as X,
  CheckCircleIcon as CheckCircle,
  WarningCircleIcon as WarningCircle,
  CloudCheckIcon as CloudCheck,
  DesktopTowerIcon as DesktopTower,
} from "@phosphor-icons/react";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { formatDate } from "@/utils/formatters";
import type { ConversationMetadata } from "@/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/services/conversations/backgroundSessionTracker";
import type { ConversationStorageScope } from "@/core/storage/chatHistoryService";
import { ClaudeCodeIcon } from "@/components/ui/ClaudeCodeIcon";

interface ConversationsDropdownProps {
  conversations:         ConversationMetadata[];
  storageScope:          ConversationStorageScope;
  currentConvId:         string | undefined;
  showConversations:     boolean;
  editingConvId:         string | null;
  editingConvTitle:      string;
  hoveredConvId:         string | null;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  onToggle:              () => void;
  onStorageScopeChange?: (scope: ConversationStorageScope) => void;
  onClose:               () => void;
  onSelectConversation:  (id: string) => void;
  onNewConversation:     () => void;
  onDeleteConversation:  (id: string, e: React.MouseEvent) => void;
  onStartEditTitle:      (id: string, title: string, e: React.MouseEvent) => void;
  onSaveConvTitle:       (id: string) => void;
  onCancelConvEdit:      () => void;
  onEditTitleChange:     (v: string) => void;
  onHoverConv:           (id: string | null) => void;
}

export const ConversationsDropdown = ({
  conversations,
  storageScope,
  currentConvId,
  showConversations,
  editingConvId,
  editingConvTitle,
  hoveredConvId,
  conversationStatuses,
  onToggle,
  onStorageScopeChange,
  onClose,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onStartEditTitle,
  onSaveConvTitle,
  onCancelConvEdit,
  onEditTitleChange,
  onHoverConv,
}: ConversationsDropdownProps) => {
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, onClose, showConversations);

  const hasActivity = conversationStatuses && conversationStatuses.size > 0;
  const handleStorageScopeChange =
    typeof onStorageScopeChange === "function" ? onStorageScopeChange : () => {};

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={onToggle}
        aria-expanded={showConversations}
        aria-haspopup="dialog"
        className="studio-chat-icon-button relative flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
        title="Conversations"
      >
        <ChatCircle size={14} weight="bold" className="text-gray-500 dark:text-gray-500 transition-colors duration-300" />
        {/* Activity dot — shows when any background conversation has a status */}
        {hasActivity && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary dark:bg-primary" />
        )}
      </button>

      <AnimatePresence>
        {showConversations && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            role="dialog"
            aria-label="Conversations"
            className="absolute left-0 top-12 w-80 bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col transition-colors duration-300"
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-surface-border transition-colors duration-300">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-600 tracking-extra-wide font-sans transition-colors duration-300">
                  CONVERSATIONS
                </h3>
                <div
                  className="relative grid grid-cols-2 gap-0.5 rounded-full border border-gray-200 dark:border-surface-border bg-gray-50 dark:bg-surface-selected p-0.5"
                  aria-label="Conversation storage"
                >
                  {(["cloud", "local"] as const).map((scope) => {
                    const active = storageScope === scope;
                    const Icon = scope === "cloud" ? CloudCheck : DesktopTower;
                    return (
                      <button
                        key={scope}
                        type="button"
                        title={scope === "cloud" ? "Cloud conversations" : "Local conversations"}
                        aria-pressed={active}
                        onClick={() => {
                          if (!active) handleStorageScopeChange(scope);
                        }}
                        className={`relative z-10 h-7 w-9 rounded-full flex items-center justify-center transition-colors ${
                          active
                            ? "text-gray-900 dark:text-gray-100"
                            : "text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="conversation-storage-switch"
                            className="absolute inset-0 rounded-full bg-white dark:bg-surface-base shadow-sm"
                            transition={{ type: "spring", stiffness: 420, damping: 32 }}
                          />
                        )}
                        <Icon size={14} weight={active ? "fill" : "regular"} className="relative z-10" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-2 py-2">
              <button
                onClick={onNewConversation}
                className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-raised rounded-lg transition-smooth text-gray-900 dark:text-gray-300"
              >
                + New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-auto-hide px-2 pb-2">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400 transition-colors duration-300">
                  No conversations yet
                </div>
              ) : (
                conversations.map((conv) => {
                  const status = conversationStatuses?.get(conv.id);
                  const isCurrentlyViewing = conv.id === currentConvId;
                  const isClaudeOwned = conv.owner === "claude";

                  return (
                    <div
                      key={conv.id}
                      onMouseEnter={() => onHoverConv(conv.id)}
                      onMouseLeave={() => onHoverConv(null)}
                      className={`relative mb-1 rounded-lg ${
                        isCurrentlyViewing ? "bg-gray-100 dark:bg-surface-raised" : ""
                      }`}
                    >
                      {editingConvId === conv.id ? (
                        <div className="px-3 py-2">
                          <input
                            type="text"
                            value={editingConvTitle}
                            onChange={(e) => onEditTitleChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")  onSaveConvTitle(conv.id);
                              if (e.key === "Escape") onCancelConvEdit();
                            }}
                            className="w-full px-2 py-1 text-sm bg-surface-page border border-gray-200 dark:border-surface-border rounded focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-surface-border focus:border-gray-300 dark:focus:border-surface-border text-gray-900 dark:text-gray-200 transition-colors duration-300"
                            autoFocus
                          />
                          <div className="flex gap-1 mt-1">
                            <button
                              onClick={() => onSaveConvTitle(conv.id)}
                              className="p-1 hover:bg-gray-200 rounded transition-smooth"
                            >
                              <Check size={12} weight="bold" className="text-gray-600" />
                            </button>
                            <button
                              onClick={onCancelConvEdit}
                              className="p-1 hover:bg-gray-200 rounded transition-smooth"
                            >
                              <X size={12} weight="bold" className="text-gray-600" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => onSelectConversation(conv.id)}
                            className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-raised rounded-lg transition-smooth"
                          >
                            <div className="flex items-center gap-2 pr-16">
                              {isClaudeOwned && (
                                <span title="Claude Code native conversation" className="flex-shrink-0">
                                  <ClaudeCodeIcon size={13} />
                                </span>
                              )}
                              <p className="text-gray-900 dark:text-gray-300 truncate flex-1 transition-colors duration-300">
                                {conv.title}
                              </p>
                              {/* Status icon — only when not currently in this conversation */}
                              {!isCurrentlyViewing && status === "streaming" && (
                                <span className="flex-shrink-0 w-3.5 h-3.5 relative">
                                  <span className="absolute inset-0 rounded-full border-2 border-primary dark:border-primary border-t-transparent animate-spin" />
                                </span>
                              )}
                              {!isCurrentlyViewing && status === "done_unread" && (
                                <CheckCircle
                                  size={14}
                                  weight="fill"
                                  className="flex-shrink-0 text-secondary dark:text-secondary"
                                />
                              )}
                              {!isCurrentlyViewing && status === "permission_needed" && (
                                <WarningCircle
                                  size={14}
                                  weight="fill"
                                  className="flex-shrink-0 text-secondary dark:text-secondary animate-pulse"
                                />
                              )}
                            </div>
                            <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5 transition-colors duration-300">
                              {conv.messageCount} messages · {isClaudeOwned ? "Claude Code" : "Studio"} · {formatDate(conv.updatedAt)}
                            </p>
                          </button>
                          <AnimatePresence>
                            {hoveredConvId === conv.id && !isClaudeOwned && (
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute right-2 top-2 flex gap-1 z-10"
                              >
                                <button
                                  onClick={(e) => onStartEditTitle(conv.id, conv.title, e)}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-surface-border rounded transition-smooth bg-white dark:bg-surface-base"
                                >
                                  <PencilSimple size={12} weight="bold" className="text-gray-600 dark:text-gray-500" />
                                </button>
                                <button
                                  onClick={(e) => onDeleteConversation(conv.id, e)}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-surface-border rounded transition-smooth bg-white dark:bg-surface-base"
                                >
                                  <Trash size={12} weight="bold" className="text-gray-600 dark:text-gray-500" />
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
