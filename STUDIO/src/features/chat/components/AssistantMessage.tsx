import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/features/markdown";
import { StreamingText } from "@/features/chat/components/StreamingMarkdown";
import { RuntimeStepCard } from "@/runtime";
import { InlineToolSteps } from "@/runtime";
import { InlinePermissionRequest } from "@/features/permissions/components/InlinePermissionRequest";
import { ScreenshotThumbnail } from "./ScreenshotThumbnail";
import { MessageActions } from "./MessageActions";
import type { ChatMessage, MessageSegment } from "@/types";
import type { ActiveToolCall } from "@/features/chat/context/types";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/ui/primitives/Button";

// Memoised markdown to avoid re-renders on unrelated state changes.
const MemoizedMarkdown = memo(({ content }: { content: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
    {content}
  </ReactMarkdown>
));

interface AssistantMessageProps {
  message:            ChatMessage;
  isEditing:          boolean;
  editingContent:     string;
  editTextareaRef:    React.RefObject<HTMLTextAreaElement | null>;
  isLoading:          boolean;
  isStreaming:        boolean;
  streamingContent:   string;
  streamingMessageId: string | null;
  harnessSegments:    MessageSegment[];
  streamToolCalls:    ActiveToolCall[];
  isLastAssistant:    boolean;
  copiedMessageId:    string | null;
  ttsPlayingId:       string | null;
  ttsLoadingId:       string | null;
  ttsMenuId:          string | null;
  onEditChange:       (v: string) => void;
  onSaveEdit:         () => void;
  onCancelEdit:       () => void;
  onCopy:             (content: string, id: string) => void;
  onEdit:             (id: string, content: string) => void;
  onDelete:           (id: string) => void;
  onSpeak:            (id: string, content: string) => void;
  onSetTtsMenuId:     (id: string | null) => void;
  onRegenerate:       () => void;
  onContinue:         () => void;
}

export const AssistantMessage = ({
  message,
  isEditing,
  editingContent,
  editTextareaRef,
  isLoading,
  isStreaming,
  streamingContent,
  streamingMessageId,
  harnessSegments,
  streamToolCalls,
  isLastAssistant,
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
}: AssistantMessageProps) => {
  const isStreamingThisMessage = message.id === streamingMessageId;

  return (
    <div className="w-full flex flex-col">
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
            <textarea
              ref={editTextareaRef}
              value={editingContent}
              onChange={(e) => onEditChange(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-surface-base border border-gray-200 dark:border-surface-border rounded-xl resize-none focus:outline-none focus:border-gray-300 dark:focus:border-surface-border text-sm font-normal text-gray-800 dark:text-gray-200 transition-colors duration-200 leading-relaxed scrollbar-thin"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSaveEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={onSaveEdit}
                disabled={!editingContent.trim()}
                variant="primary"
                className="h-auto gap-1.5 px-3 py-1.5 text-xs bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 rounded hover:bg-gray-700 dark:hover:bg-gray-300 disabled:opacity-40"
              >
                Save
              </Button>
              <Button
                onClick={onCancelEdit}
                variant="ghost"
                className="h-auto px-3 py-1.5 text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400"
              >
                Cancel
              </Button>
              <span className="text-2xs text-gray-300 dark:text-gray-700 ml-auto">⌘ Enter · Esc to cancel</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Display mode */}
      {!isEditing && (
        <div className="w-full">
          {message.metadata?.type === "permission-request" ? (
            <div>
              <div className="prose-chat mb-3">
                <MemoizedMarkdown content={message.content} />
              </div>
              {message.metadata.operation && message.metadata.onApprove && message.metadata.onDeny && (
                <InlinePermissionRequest
                  operation={message.metadata.operation}
                  onApprove={message.metadata.onApprove}
                  onDeny={message.metadata.onDeny}
                />
              )}
            </div>
          ) : (
            <div className="w-full flex flex-col gap-2 min-w-0">
              {/* Reasoning is a live-only, ephemeral surface owned by the bottom
                  status line (TurnStatus) while a turn is in flight. It is never
                  resent to the model and is not shown per-message afterwards, so
                  there's exactly one thinking surface at a time and no live→
                  historical handoff flicker. */}

              {/* Live streaming with harness segments */}
              {isStreamingThisMessage && harnessSegments.length > 0 ? (
                <>
                  {harnessSegments.map((seg, i) =>
                    seg.type === "text" ? (
                      <div key={i} className="prose-chat">
                        <MemoizedMarkdown content={seg.content} />
                      </div>
                    ) : seg.type === "harness_event" ? (
                      <RuntimeStepCard key={seg.event.callId} event={seg.event} />
                    ) : (
                      <InlineQuestionAnswer
                        key={seg.id}
                        question={seg.question}
                        answer={seg.answer}
                      />
                    )
                  )}
                  {streamingContent && (
                    <StreamingText content={streamingContent} showCursor={isStreaming} className="prose-chat" />
                  )}
                </>
              ) : isStreamingThisMessage && isStreaming && streamingContent.length > 0 ? (
                /* Pure text streaming (no harness tools) */
                <StreamingText content={streamingContent} showCursor={isStreaming} className="prose-chat" />
              ) : message.segments && message.segments.length > 0 ? (
                /* Historical: interleaved segments */
                <>
                  {message.segments.map((seg, i) =>
                    seg.type === "text" ? (
                      <div key={i} className="prose-chat">
                        <MemoizedMarkdown content={seg.content} />
                      </div>
                    ) : seg.type === "harness_event" ? (
                      <RuntimeStepCard key={seg.event.callId} event={seg.event} />
                    ) : (
                      <InlineQuestionAnswer
                        key={seg.id}
                        question={seg.question}
                        answer={seg.answer}
                      />
                    )
                  )}
                </>
              ) : (
                /* Historical: plain content */
                <div className="prose-chat">
                  <MemoizedMarkdown content={message.content || streamingContent} />
                </div>
              )}

              {/* Non-harness stream tool capsules */}
              {isStreamingThisMessage && streamToolCalls.length > 0 && harnessSegments.length === 0 && (
                <InlineToolSteps steps={streamToolCalls} cycle={0} />
              )}

              {/* Screenshots captured by MCP tools */}
              {message.imageUrls && message.imageUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {message.imageUrls.map((url, idx) => (
                    <ScreenshotThumbnail key={idx} url={url} idx={idx} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      {!isEditing && (
        <MessageActions
          message={message}
          isLoading={isLoading}
          isLastAssistant={isLastAssistant}
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
    </div>
  );
};

function InlineQuestionAnswer({ question, answer }: { question: string; answer?: string }) {
  return (
    <div className="my-2 w-full max-w-xl rounded-xl border border-gray-200 bg-gray-50/70 px-3.5 py-3 dark:border-surface-border dark:bg-surface-base">
      <div>
        <div className="text-2xs font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
          Question
        </div>
        <p className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {question}
        </p>
      </div>
      {answer ? (
        <div className="mt-3 border-t border-gray-200 pt-3 dark:border-surface-border">
          <div className="text-2xs font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
            Your answer
          </div>
          <p className="mt-1 text-sm font-medium leading-relaxed text-gray-900 dark:text-gray-100">
            {answer}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
          Waiting for your answer...
        </p>
      )}
    </div>
  );
}
