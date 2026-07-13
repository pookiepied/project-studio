import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  Close,
  Collapse,
  Delete,
  Edit,
  Error,
  FolderOpen,
  Icon,
  Message,
  More,
  SidebarSimpleIcon,
  StackIcon,
  Success,
} from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Input } from "@/ui/primitives/Input";
import { formatDate } from "@/lib/formatters";
import { ClaudeCodeIcon } from "@/ui/brand";
import type { ConversationMetadata } from "@/features/chat/hooks/useConversationsList";
import type { ConversationSessionStatus } from "@/features/chat/conversations/backgroundSessionTracker";

export function ConversationRow({
  conv,
  currentConvId,
  conversationStatuses,
  editingConvId,
  editingConvTitle,
  onSelectConversation,
  onSaveConvTitle,
  onCancelConvEdit,
  onEditTitleChange,
  onOpenMenu,
  menuOpen,
  onCloseMenu,
}: {
  conv: ConversationMetadata;
  currentConvId?: string;
  conversationStatuses?: Map<string, ConversationSessionStatus>;
  editingConvId: string | null;
  editingConvTitle: string;
  onSelectConversation: (id: string) => void;
  onSaveConvTitle: (id: string) => void;
  onCancelConvEdit: () => void;
  onEditTitleChange: (value: string) => void;
  onOpenMenu: (rect: DOMRect) => void;
  menuOpen: boolean;
  onCloseMenu: () => void;
}) {
  const status = conversationStatuses?.get(conv.id);
  const current = conv.id === currentConvId;
  const isClaudeOwned = conv.owner === "claude";

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(event.currentTarget.getBoundingClientRect());
      }}
      className={`group relative mb-0.5 rounded-xl ${current ? "bg-surface-selected" : ""}`}
    >
      {editingConvId === conv.id ? (
        <div className="p-2">
          <Input
            autoFocus
            size="sm"
            value={editingConvTitle}
            onChange={(event) => onEditTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSaveConvTitle(conv.id);
              if (event.key === "Escape") onCancelConvEdit();
            }}
            className="bg-surface-page text-xs"
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => onSelectConversation(conv.id)}
          className="w-full rounded-xl px-3 py-2 text-left hover:bg-surface-hover"
        >
          <div className="flex items-center gap-2 pr-6">
            {isClaudeOwned ? (
              <ClaudeCodeIcon size={13} />
            ) : (
              <Message size="xs" weight={current ? "fill" : undefined} className="text-secondary" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{conv.title}</span>
            {status === "streaming" && (
              <span className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            )}
            {status === "done_unread" && <Success size="xs" weight="fill" className="text-secondary" />}
            {status === "permission_needed" && <Error size="xs" weight="fill" className="text-secondary" />}
          </div>
          <p className="mt-0.5 truncate pl-5 text-2xs text-muted">
            {conv.messageCount} messages - {formatDate(conv.updatedAt)}
          </p>
        </Button>
      )}

      {editingConvId !== conv.id && (
        <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 group-hover:flex">
          <ConversationActionsButton open={menuOpen} onOpen={onOpenMenu} onClose={onCloseMenu} />
        </div>
      )}
    </div>
  );
}

export function ProjectRow({
  name,
  path,
  expanded,
  isCurrent,
  projectEnabled,
  hasRegisteredProject,
  conversationCount,
  onToggle,
  onSelect,
  onOpenFolder,
  onRemove,
  onDelete,
}: {
  name: string;
  path: string;
  expanded: boolean;
  isCurrent: boolean;
  projectEnabled: boolean;
  hasRegisteredProject: boolean;
  conversationCount: number;
  onToggle: () => void;
  onSelect: () => void;
  onOpenFolder: () => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group relative rounded-xl ${isCurrent ? "bg-surface-selected" : ""}`}>
      <div className="flex items-center">
        <IconButton
          aria-label={expanded ? "Collapse project" : "Expand project"}
          onClick={onToggle}
          className="h-7 w-6 flex-shrink-0 rounded-l-xl text-muted hover:text-primary"
        >
          <Collapse size="xs" className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </IconButton>
        <Button
          variant="ghost"
          onClick={onSelect}
          disabled={!projectEnabled || !hasRegisteredProject}
          className="min-w-0 flex-1 items-center gap-2 py-2 pr-16 text-left disabled:opacity-60"
        >
          <FolderOpen size="xs" weight={isCurrent ? "fill" : undefined} className="flex-shrink-0 text-secondary" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">{name}</span>
          {conversationCount > 0 && (
            <span className="rounded-full bg-surface-page px-1.5 py-0.5 text-2xs font-medium text-muted">
              {conversationCount}
            </span>
          )}
        </Button>
      </div>
      <p className="truncate pl-6 pr-2 pb-1 text-2xs text-muted">{path}</p>

      {hasRegisteredProject && (
        <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
          <IconButton
            aria-label="Open folder"
            title="Open folder"
            onClick={(event) => { event.stopPropagation(); onOpenFolder(); }}
            className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
          >
            <FolderOpen size="xs" />
          </IconButton>
          <IconButton
            aria-label="Remove from list"
            title="Remove from list"
            onClick={(event) => { event.stopPropagation(); onRemove(); }}
            className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
          >
            <Close size="xs" />
          </IconButton>
          <IconButton
            aria-label="Delete Studio project data"
            title="Delete Studio project data"
            onClick={(event) => { event.stopPropagation(); onDelete(); }}
            className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
          >
            <Delete size="xs" />
          </IconButton>
        </div>
      )}
    </div>
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
    <IconButton
      aria-label="Conversation actions"
      title="Conversation actions"
      onClick={(event) => {
        event.stopPropagation();
        if (open) onClose();
        else onOpen(event.currentTarget.getBoundingClientRect());
      }}
      className="h-6 w-6 rounded-lg bg-surface-base text-muted hover:bg-surface-hover hover:text-primary"
    >
      <More size="sm" />
    </IconButton>
  );
}

export function ConversationActionsMenu({
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
  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-secondary hover:bg-surface-hover hover:text-primary";
  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onMouseDown={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
        className="w-48 overflow-hidden rounded-xl border border-surface-border bg-surface-base p-1.5 shadow-xl"
      >
        {!isCurrent && (
          <Button
            variant="ghost"
            onClick={() => {
              onSelectConversation(conv.id);
              onClose();
              onPanelClose();
            }}
            className={itemClass}
          >
            <Message size="sm" /> Open
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            onOpenConversationInSideChat?.(conv.id, conv.title);
            onClose();
          }}
          className={itemClass}
        >
          <Icon icon={SidebarSimpleIcon} size="sm" /> Open in Side Chat
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onOpenConversationInNewWindow?.(conv.id);
            onClose();
          }}
          className={itemClass}
        >
          <Icon icon={StackIcon} size="sm" /> Open in New Window
        </Button>
        {!isClaudeOwned && (
          <>
            <div className="my-1 h-px bg-surface-divider" />
            <Button
              variant="ghost"
              onClick={(event) => { onStartEditTitle(conv.id, conv.title, event); onClose(); }}
              className={itemClass}
            >
              <Edit size="sm" /> Rename
            </Button>
            <Button
              variant="ghost"
              onClick={(event) => { onDeleteConversation(conv.id, event); onClose(); }}
              className={itemClass}
            >
              <Delete size="sm" /> Delete
            </Button>
          </>
        )}
      </motion.div>
    </>,
    document.body,
  );
}
