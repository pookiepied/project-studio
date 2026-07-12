import { motion } from "framer-motion";
import {
  TrashIcon as Trash,
  PencilSimpleIcon as PencilSimple,
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowRightIcon as ArrowRight,
  DotsThreeIcon as DotsThree,
  SpeakerHighIcon as SpeakerHigh,
  StopIcon as Stop,
  CheckIcon as Check,
  CopyIcon as Copy,
} from "@phosphor-icons/react";
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
        ? <Check       size={14} weight="bold" className="text-secondary" />
        : <Copy        size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />}
    </IconButton>

    {/* Edit */}
    <IconButton
      onClick={() => onEdit(message.id, message.content)}
      aria-label="Edit"
      title="Edit"
      className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
    >
      <PencilSimple size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />
    </IconButton>

    {/* Delete */}
    <IconButton
      onClick={() => onDelete(message.id)}
      aria-label="Delete"
      title="Delete"
      className="h-6 w-6 rounded hover:bg-gray-100 dark:hover:bg-surface-raised transition-smooth"
    >
      <Trash size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />
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
          <Stop        size={14} weight="fill"  className="text-gray-500 dark:text-gray-500" />
        ) : (
          <SpeakerHigh size={14} weight="bold"  className="text-gray-400 dark:text-gray-600" />
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
          <DotsThree size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />
        </IconButton>
        {ttsMenuId === message.id && (
          <div role="menu" className="absolute bottom-full right-0 mb-1 bg-white dark:bg-surface-raised border border-gray-100 dark:border-surface-border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
            {isLastAssistant ? (
              <>
                <Button variant="ghost" role="menuitem" onClick={() => { onRegenerate(); onSetTtsMenuId(null); }}
                  className="h-auto w-full justify-start gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border"
                >
                  <ArrowClockwise size={14} weight="bold" className="flex-shrink-0" />
                  Regenerate
                </Button>
                <Button variant="ghost" role="menuitem" onClick={() => { onContinue(); onSetTtsMenuId(null); }}
                  className="h-auto w-full justify-start gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border"
                >
                  <ArrowRight size={14} weight="bold" className="flex-shrink-0" />
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
