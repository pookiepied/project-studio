import { motion } from "framer-motion";
import {
  Delete,
  Edit,
  Redo,
  Forward,
  More,
  Volume,
  Stop,
  Check,
  Copy,
} from "@/ui/icons";
import type { ChatMessage } from "@/types";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

// ── Component ────────────────────────────────────────────────────────────────

interface MessageActionsProps {
  message:            ChatMessage;
  isLoading:          boolean;
  isLastAssistant:    boolean;
  copiedMessageId:    string | null;
  ttsPlayingId:       string | null;
  ttsLoadingId:       string | null;
  ttsMenuId:          string | null;
  onCopy:             (content: string, id: string) => void;
  onEdit:             (id: string, content: string) => void;
  onDelete:           (id: string) => void;
  onSpeak:            (id: string, content: string) => void;
  onSetTtsMenuId:     (id: string | null) => void;
  onRegenerate:       () => void;
  onContinue:         () => void;
}

export const MessageActions = ({
  message,
  isLoading,
  isLastAssistant,
  copiedMessageId,
  ttsPlayingId,
  ttsLoadingId,
  ttsMenuId,
  onCopy,
  onEdit,
  onDelete,
  onSpeak,
  onSetTtsMenuId,
  onRegenerate,
  onContinue,
}: MessageActionsProps) => {
  // Keep the bar visible (even without hover) whenever it owns live state the
  // user needs to reach: read-aloud playing/loading, or an open menu/popup.
  // Otherwise moving the cursor off the message would fade out the Stop button
  // or the menu the user is trying to click.
  const forceVisible =
    ttsPlayingId === message.id ||
    ttsLoadingId === message.id ||
    ttsMenuId === message.id;

  return (
  <motion.div
    initial={{ opacity: 0 }}
    whileHover={{ opacity: 1 }}
    className={`absolute top-full pt-2 pb-1 flex items-center gap-0.5 pointer-events-auto transition-opacity duration-150 z-10 ${
      isLoading
        ? "opacity-0 pointer-events-none"
        : forceVisible
          ? "opacity-100"
          // Faint-but-clickable at rest on desktop (not fully hidden) — you no
          // longer have to hunt for a precise hover spot to find or use these
          // actions; hovering the message just brings them to full opacity.
          : "opacity-100 md:opacity-35 md:group-hover:opacity-100"
    } ${message.role === "user" ? "right-0" : "left-0"}`}
  >
    {/* Copy */}
    <IconButton
      onClick={() => onCopy(message.content, message.id)}
      aria-label="Copy"
      title="Copy"
      className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
    >
      {copiedMessageId === message.id
        ? <Check       size="sm" className="text-secondary" />
        : <Copy        size="sm" className="text-gray-400 dark:text-gray-600" />}
    </IconButton>

    {/* Edit */}
    <IconButton
      onClick={() => onEdit(message.id, message.content)}
      aria-label="Edit"
      title="Edit"
      className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
    >
      <Edit size="sm" className="text-gray-400 dark:text-gray-600" />
    </IconButton>

    {/* Delete */}
    <IconButton
      onClick={() => onDelete(message.id)}
      aria-label="Delete"
      title="Delete"
      className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
    >
      <Delete size="sm" className="text-gray-400 dark:text-gray-600" />
    </IconButton>

    {/* Read aloud — assistant only */}
    {message.role === "assistant" && (
      <IconButton
        onClick={() => onSpeak(message.id, message.content)}
        aria-label={ttsPlayingId === message.id ? "Stop" : "Read aloud"}
        title={ttsPlayingId === message.id ? "Stop" : "Read aloud"}
        className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
      >
        {ttsLoadingId === message.id ? (
          <span className="w-3 h-3 border border-gray-400 dark:border-gray-600 border-t-transparent rounded-full animate-spin block flex-shrink-0" />
        ) : ttsPlayingId === message.id ? (
          <Stop        size="sm" weight="fill"  className="text-gray-500 dark:text-gray-500" />
        ) : (
          <Volume size="sm"  className="text-gray-400 dark:text-gray-600" />
        )}
      </IconButton>
    )}

    {/* More actions (Regenerate / Continue) — assistant only */}
    {message.role === "assistant" && (
      <div className="relative flex items-center">
        <IconButton
          onClick={(e) => { e.stopPropagation(); onSetTtsMenuId(ttsMenuId === message.id ? null : message.id); }}
          aria-label="More actions"
          aria-expanded={ttsMenuId === message.id}
          aria-haspopup="menu"
          title="More actions"
          className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
        >
          <More size="sm" className="text-gray-400 dark:text-gray-600" />
        </IconButton>
        {ttsMenuId === message.id && (
          <div role="menu" className="absolute bottom-full right-0 mb-1 bg-white dark:bg-surface-raised border border-gray-100 dark:border-surface-border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
            {isLastAssistant ? (
              <>
                <Button variant="ghost" role="menuitem" onClick={() => { onRegenerate(); onSetTtsMenuId(null); }}
                  className="h-auto w-full justify-start gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border"
                >
                  <Redo size="sm" className="flex-shrink-0" />
                  Regenerate
                </Button>
                <Button variant="ghost" role="menuitem" onClick={() => { onContinue(); onSetTtsMenuId(null); }}
                  className="h-auto w-full justify-start gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border"
                >
                  <Forward size="sm" className="flex-shrink-0" />
                  Continue
                </Button>
              </>
            ) : (
              <p className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-600 italic">No actions</p>
            )}
          </div>
        )}
      </div>
    )}
  </motion.div>
  );
};
