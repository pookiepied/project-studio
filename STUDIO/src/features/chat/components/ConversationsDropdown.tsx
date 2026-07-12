import { useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PencilSimpleIcon as PencilSimple,
  TrashIcon as Trash,
  CheckIcon as Check,
  XIcon as X,
  CheckCircleIcon as CheckCircle,
  WarningCircleIcon as WarningCircle,
  StackIcon as Stack,
  FolderOpenIcon as FolderOpen,
  MinusCircleIcon as MinusCircle,
  CaretDownIcon as CaretDown,
} from "@phosphor-icons/react";
import { useOnClickOutside } from "@/lib/hooks/useOnClickOutside";
import { formatDate } from "@/lib/formatters";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";
import type { ProjectEntry } from "@/core/projects";
import { ClaudeCodeIcon } from "@/ui/brand";

type Tab = "projects" | "conversations";

interface ConversationsDropdownProps {
  /** The centered work identity shown in the trigger — project / conversation title. */
  label:                 ReactNode;
  conversations:         ConversationMetadata[];
  currentConvId:         string | undefined;
  showConversations:     boolean;
  editingConvId:         string | null;
  editingConvTitle:      string;
  hoveredConvId:         string | null;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  onToggle:              () => void;
  onClose:               () => void;
  onSelectConversation:  (id: string) => void;
  onNewConversation:     () => void;
  onDeleteConversation:  (id: string, e: React.MouseEvent) => void;
  onStartEditTitle:      (id: string, title: string, e: React.MouseEvent) => void;
  onSaveConvTitle:       (id: string) => void;
  onCancelConvEdit:      () => void;
  onEditTitleChange:     (v: string) => void;
  onHoverConv:           (id: string | null) => void;
  // Projects
  projects:              ProjectEntry[];
  currentProjectPath?:   string;
  onSelectProject:       (project: ProjectEntry) => void;
  onOpenProjectFolder:   () => void;
  onRemoveProject:       (id: string) => void;
  onDeleteProject:       (id: string) => void;
}

export const ConversationsDropdown = ({
  label,
  conversations,
  currentConvId,
  showConversations,
  editingConvId,
  editingConvTitle,
  hoveredConvId,
  conversationStatuses,
  onToggle,
  onClose,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onStartEditTitle,
  onSaveConvTitle,
  onCancelConvEdit,
  onEditTitleChange,
  onHoverConv,
  projects,
  currentProjectPath,
  onSelectProject,
  onOpenProjectFolder,
  onRemoveProject,
  onDeleteProject,
}: ConversationsDropdownProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("conversations");
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  useOnClickOutside(ref, onClose, showConversations);

  const hasActivity = conversationStatuses && conversationStatuses.size > 0;

  return (
    <div ref={ref} className="relative flex min-w-0 flex-shrink">
      {/* Center trigger — the work identity, Safari-address-bar style: it is both
          the label and the switcher control. */}
      <button
        data-conv-toggle
        onClick={onToggle}
        aria-expanded={showConversations}
        aria-haspopup="dialog"
        className="relative flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
        title="Projects and conversations"
      >
        <Stack size={14} weight="bold" className="flex-shrink-0 text-gray-500 dark:text-gray-500" />
        <span className="min-w-0 truncate">{label}</span>
        <CaretDown size={12} weight="bold" className={`flex-shrink-0 text-gray-400 dark:text-gray-600 transition-transform duration-200 ${showConversations ? "rotate-180" : ""}`} />
        {/* Activity dot — shows when any background conversation has a status */}
        {hasActivity && (
          <span className="absolute left-4 top-1 h-1.5 w-1.5 rounded-full bg-primary dark:bg-primary" />
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
            className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 w-80 bg-white dark:bg-surface-base border border-gray-200 dark:border-surface-border rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col transition-colors duration-300"
          >
            <div className="px-2 pt-2 border-b border-gray-200 dark:border-surface-border transition-colors duration-300">
              <div className="relative flex items-center gap-1" role="tablist">
                {(["projects", "conversations"] as const).map((key) => {
                  const active = tab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(key)}
                      className={`relative px-3 py-2 text-xs font-semibold tracking-extra-wide font-sans transition-colors ${
                        active
                          ? "text-gray-900 dark:text-gray-200"
                          : "text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400"
                      }`}
                    >
                      {key === "projects" ? "PROJECTS" : "CONVERSATIONS"}
                      {active && (
                        <motion.span
                          layoutId="workspace-dropdown-tab"
                          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gray-900 dark:bg-gray-200"
                          transition={{ type: "spring", stiffness: 420, damping: 32 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-2 py-2">
              <button
                onClick={tab === "projects" ? onOpenProjectFolder : onNewConversation}
                className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-raised rounded-lg transition-smooth text-gray-900 dark:text-gray-300"
              >
                {tab === "projects" ? "+ Open project folder" : "+ New Chat"}
              </button>
            </div>

            {tab === "projects" && (
              <div className="flex-1 overflow-y-auto scrollbar-auto-hide px-2 pb-2">
                {projects.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400 transition-colors duration-300">
                    No projects yet
                  </div>
                ) : (
                  projects.map((project) => {
                    const isCurrent = project.path === currentProjectPath;
                    return (
                      <div
                        key={project.id}
                        onMouseEnter={() => setHoveredProjectId(project.id)}
                        onMouseLeave={() => setHoveredProjectId(null)}
                        className={`relative mb-1 rounded-lg ${isCurrent ? "bg-gray-100 dark:bg-surface-raised" : ""}`}
                      >
                        <button
                          onClick={() => onSelectProject(project)}
                          className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-raised rounded-lg transition-smooth"
                        >
                          <div className="flex items-center gap-2 pr-16">
                            <FolderOpen size={14} weight={isCurrent ? "fill" : "regular"} className="flex-shrink-0 text-gray-400 dark:text-gray-600" />
                            <p className="text-gray-900 dark:text-gray-300 truncate flex-1 transition-colors duration-300">
                              {project.name}
                            </p>
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5 truncate transition-colors duration-300">
                            {project.path}
                          </p>
                        </button>

                        <AnimatePresence>
                          {hoveredProjectId === project.id && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute right-2 top-2 flex gap-1 z-10"
                            >
                              <button
                                title="Remove from list (keeps all files)"
                                onClick={(e) => { e.stopPropagation(); onRemoveProject(project.id); }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-surface-border rounded transition-smooth bg-white dark:bg-surface-base"
                              >
                                <MinusCircle size={14} weight="bold" className="text-gray-600 dark:text-gray-500" />
                              </button>
                              <button
                                title="Delete Studio's data for this project (your folder is untouched)"
                                onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-surface-border rounded transition-smooth bg-white dark:bg-surface-base"
                              >
                                <Trash size={14} weight="bold" className="text-gray-600 dark:text-gray-500" />
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "conversations" && (
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
                              <Check size={14} weight="bold" className="text-gray-600" />
                            </button>
                            <button
                              onClick={onCancelConvEdit}
                              className="p-1 hover:bg-gray-200 rounded transition-smooth"
                            >
                              <X size={14} weight="bold" className="text-gray-600" />
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
                                  <ClaudeCodeIcon size={14} />
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
                                  <PencilSimple size={14} weight="bold" className="text-gray-600 dark:text-gray-500" />
                                </button>
                                <button
                                  onClick={(e) => onDeleteConversation(conv.id, e)}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-surface-border rounded transition-smooth bg-white dark:bg-surface-base"
                                >
                                  <Trash size={14} weight="bold" className="text-gray-600 dark:text-gray-500" />
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
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
