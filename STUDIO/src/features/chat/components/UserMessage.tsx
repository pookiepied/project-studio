import { motion, AnimatePresence } from "framer-motion";
import { Check } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { Textarea } from "@/ui/primitives/Textarea";
import type { ChatMessage } from "@/types";
import { DocumentAttachmentChip } from "./DocumentAttachmentChip";
import { ImageWithFallback } from "./ImageWithFallback";
import { MessageActions } from "./MessageActions";
import { CollapsibleUserText } from "./CollapsibleUserText";

interface UserMessageProps {
  message:          ChatMessage;
  isEditing:        boolean;
  editingContent:   string;
  editTextareaRef:  React.RefObject<HTMLTextAreaElement | null>;
  isLoading:        boolean;
  copiedMessageId:  string | null;
  ttsPlayingId:     string | null;
  ttsLoadingId:     string | null;
  ttsMenuId:        string | null;
  onEditChange:     (v: string) => void;
  onSaveEdit:       () => void;
  onCancelEdit:     () => void;
  onCopy:           (content: string, id: string) => void;
  onEdit:           (id: string, content: string) => void;
  onDelete:         (id: string) => void;
  onSpeak:          (id: string, content: string) => void;
  onSetTtsMenuId:   (id: string | null) => void;
  onRegenerate:     () => void;
  onContinue:       () => void;
}

export const UserMessage = ({
  message,
  isEditing,
  editingContent,
  editTextareaRef,
  isLoading,
  copiedMessageId,
  ttsPlayingId,
  ttsLoadingId,
  ttsMenuId,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  onCopy,
  onEdit,
  onDelete,
  onSpeak,
  onSetTtsMenuId,
  onRegenerate,
  onContinue,
}: UserMessageProps) => (
  <>
    {/* Edit mode */}
    <AnimatePresence>
      {isEditing && (
        <motion.div
          key={`edit-${message.id}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-2 w-full max-w-2xl"
        >
          <Textarea
            ref={editTextareaRef}
            value={editingContent}
            onChange={(e) => onEditChange(e.target.value)}
            className="resize-none rounded-xl bg-surface-base px-3 py-2.5 text-sm font-normal leading-relaxed text-primary scrollbar-thin focus-visible:ring-0"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSaveEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onSaveEdit}
              disabled={!editingContent.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary dark:bg-surface-raised text-on-emphasis dark:text-primary rounded hover:bg-secondary dark:hover:bg-surface-selected disabled:opacity-40 transition-colors"
            >
              <Check size="xs" />
              Save &amp; Send
            </Button>
            <Button
              variant="ghost"
              onClick={onCancelEdit}
              className="px-3 py-1.5 text-xs font-medium text-disabled dark:text-secondary hover:text-secondary dark:hover:text-disabled transition-colors"
            >
              Cancel
            </Button>
            <span className="text-2xs text-disabled dark:text-secondary ml-auto">⌘ Enter · Esc to cancel</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Display mode */}
    {!isEditing && (
      <div className="flex flex-col items-end gap-1.5 max-w-[88%] sm:max-w-[75%] md:max-w-[70%]">
        {/* Images — frameless, rounded, clickable for lightbox */}
        {message.imageUrls && message.imageUrls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {message.imageUrls.map((url, idx) => (
              <ImageWithFallback key={idx} url={url} idx={idx} />
            ))}
          </div>
        )}
        {/* Document attachment chips */}
        {message.documentAttachments && message.documentAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {message.documentAttachments.map((doc, idx) => (
              <DocumentAttachmentChip key={idx} name={doc.name} extension={doc.extension} />
            ))}
          </div>
        )}
        {/* Text bubble — only if there's text. Long text collapses with a
            fade + "Show more"/"Show less" toggle. */}
        {message.content && (
          <div className="bg-surface-base dark:bg-surface-raised text-primary dark:text-disabled rounded-2xl px-4 py-3 transition-colors duration-300">
            <CollapsibleUserText content={message.content} />
          </div>
        )}
      </div>
    )}

    {/* Action bar */}
    {!isEditing && (
      <MessageActions
        message={message}
        isLoading={isLoading}
        isLastAssistant={false}
        copiedMessageId={copiedMessageId}
        ttsPlayingId={ttsPlayingId}
        ttsLoadingId={ttsLoadingId}
        ttsMenuId={ttsMenuId}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
        onSpeak={onSpeak}
        onSetTtsMenuId={onSetTtsMenuId}
        onRegenerate={onRegenerate}
        onContinue={onContinue}
      />
    )}
  </>
);
