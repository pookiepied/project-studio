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
    className={`absolute top-full pt-2 pb-1 flex items-center gap-0.5 transition-opacity duration-150 z-10 ${
      isLoading
        ? "opacity-0 pointer-events-none"
        : forceVisible
          ? "opacity-100 pointer-events-auto"
          : "opacity-100 md:opacity-0 md:group-hover:opacity-100 pointer-events-auto md:pointer-events-none md:group-hover:pointer-events-auto"
    } ${message.role === "user" ? "right-0" : "left-0"}`}
  >
    {/* Copy */}
    <button
      onClick={() => onCopy(message.content, message.id)}
      className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
      title="Copy"
    >
      {copiedMessageId === message.id
        ? <Check       size={14} weight="bold" className="text-secondary" />
        : <Copy        size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />}
    </button>

    {/* Edit */}
    <button
      onClick={() => onEdit(message.id, message.content)}
      className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
      title="Edit"
    >
      <PencilSimple size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />
    </button>

    {/* Delete */}
    <button
      onClick={() => onDelete(message.id)}
      className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
      title="Delete"
    >
      <Trash size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />
    </button>

    {/* Read aloud — assistant only */}
    {message.role === "assistant" && (
      <button
        onClick={() => onSpeak(message.id, message.content)}
        className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
        title={ttsPlayingId === message.id ? "Stop" : "Read aloud"}
      >
        {ttsLoadingId === message.id ? (
          <span className="w-3 h-3 border border-gray-400 dark:border-gray-600 border-t-transparent rounded-full animate-spin block flex-shrink-0" />
        ) : ttsPlayingId === message.id ? (
          <Stop        size={14} weight="fill"  className="text-gray-500 dark:text-gray-500" />
        ) : (
          <SpeakerHigh size={14} weight="bold"  className="text-gray-400 dark:text-gray-600" />
        )}
      </button>
    )}

    {/* More actions (Regenerate / Continue) — assistant only */}
    {message.role === "assistant" && (
      <div className="relative flex items-center">
        <button
          onClick={(e) => { e.stopPropagation(); onSetTtsMenuId(ttsMenuId === message.id ? null : message.id); }}
          aria-expanded={ttsMenuId === message.id}
          aria-haspopup="menu"
          className="flex items-center justify-center w-6 h-6 hover:bg-gray-100 dark:hover:bg-surface-raised rounded transition-smooth"
          title="More actions"
        >
          <DotsThree size={14} weight="bold" className="text-gray-400 dark:text-gray-600" />
        </button>
        {ttsMenuId === message.id && (
          <div role="menu" className="absolute bottom-full right-0 mb-1 bg-white dark:bg-surface-raised border border-gray-100 dark:border-surface-border rounded-lg shadow-lg py-1 min-w-[140px] z-50">
            {isLastAssistant ? (
              <>
                <button role="menuitem" onClick={() => { onRegenerate(); onSetTtsMenuId(null); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border transition-colors"
                >
                  <ArrowClockwise size={14} weight="bold" className="flex-shrink-0" />
                  Regenerate
                </button>
                <button role="menuitem" onClick={() => { onContinue(); onSetTtsMenuId(null); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-border transition-colors"
                >
                  <ArrowRight size={14} weight="bold" className="flex-shrink-0" />
                  Continue
                </button>
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
