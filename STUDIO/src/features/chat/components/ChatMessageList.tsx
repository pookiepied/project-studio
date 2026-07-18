import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StreamingText } from "@/features/chat/components/StreamingMarkdown";
import { ErrorDisplay } from "@/ui/feedback/ErrorDisplay";
import { ToolPermissionCard } from "@/run-events";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { TurnStatus } from "./idle/TurnStatus";
import { getTurnAnchorIndices } from "@/lib/turnAnchors";
import type { ChatMessage, MessageSegment } from "@/types";
import type { ActiveToolCall } from "@/features/chat/context/types";
import type { ChatEngine } from "@/cliBridges/types";

interface TurnStatusData {
  engine: ChatEngine;
  convId?: string;
  generating: boolean;
  label: string;
  thinking?: string;
  contextUsed?: number;
  contextLimit?: number;
}

interface ChatMessageListProps {
  // Messages
  messages:           ChatMessage[];
  isLoadingMore:      boolean;
  hasMoreMessages:    boolean;
  // Scroll refs provided by useChatScroll.
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef:       React.RefObject<HTMLDivElement | null>;
  messagesContentRef:   React.RefObject<HTMLDivElement | null>;
  loadMoreTriggerRef:   React.RefObject<HTMLDivElement | null>;
  // Streaming
  isLoading:            boolean;
  isStreaming:          boolean;
  streamingContent:     string;
  streamingMessageId:   string | null;
  harnessSegments:      MessageSegment[];
  activeToolCalls:      ActiveToolCall[];
  // Edit state
  editingMessageId:     string | null;
  editingContent:       string;
  editTextareaRef:      React.RefObject<HTMLTextAreaElement | null>;
  onEditChange:         (v: string) => void;
  onSaveEdit:           () => void;
  onCancelEdit:         () => void;
  // Message actions
  copiedMessageId:      string | null;
  ttsPlayingId:         string | null;
  ttsLoadingId:         string | null;
  ttsMenuId:            string | null;
  onCopy:               (content: string, id: string) => void;
  onEdit:               (id: string, content: string) => void;
  onDelete:             (id: string) => void;
  onSpeak:              (id: string, content: string) => void;
  onSetTtsMenuId:       (id: string | null) => void;
  onRegenerate:         () => void;
  onContinue:           () => void;
  // Permission
  pendingPermission:    string | null;
  onGrantPermission:    (tool: string) => void;
  onDismissPermission:  () => void;
  // Error
  error:                string | null;
  onClearError:         () => void;
  // Floating composer bottom padding so the last message clears the overlay.
  scrollPaddingBottom?: number;
  // Rendered inline as the last content item (below the answer in normal
  // flow) instead of docked as a fixed HUD above the composer; see
  // ChatPage's comment at the composer overlay for why.
  turnStatus?: TurnStatusData | null;
}

export const ChatMessageList = ({
  messages,
  isLoadingMore,
  hasMoreMessages,
  messagesContainerRef,
  messagesEndRef,
  messagesContentRef,
  loadMoreTriggerRef,
  isLoading,
  isStreaming,
  streamingContent,
  streamingMessageId,
  harnessSegments,
  activeToolCalls,
  editingMessageId,
  editingContent,
  editTextareaRef,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
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
  pendingPermission,
  onGrantPermission,
  onDismissPermission,
  error,
  onClearError,
  scrollPaddingBottom,
  turnStatus,
}: ChatMessageListProps) => {
  // Tag each turn-anchor message with its ordinal so ConversationRail can query
  // them. Shared anchor rule keeps the rail and the list in sync under deletion.
  const messagesWithTurnIndex = useMemo(() => {
    const ordinalByIndex = new Map<number, number>();
    getTurnAnchorIndices(messages).forEach((mi, ord) => ordinalByIndex.set(mi, ord));
    return messages.map((m, idx) => ({
      ...m,
      turnIndex: ordinalByIndex.has(idx) ? ordinalByIndex.get(idx) : undefined,
    }));
  }, [messages]);

  const visibleActiveToolCalls = useMemo(
    () => activeToolCalls.filter((tc) => !tc.parentCallId),
    [activeToolCalls]
  );

  const streamToolCalls = useMemo(
    () => visibleActiveToolCalls.filter(
      (tc) => tc.displayClass === "stream" &&
               tc.status !== "pending_question" &&
               tc.status !== "pending_approval"
    ),
    [visibleActiveToolCalls]
  );

  const lastAssistantMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scroll area */}
      <div
        className="chat-scroll-container flex-1 overflow-y-auto overflow-x-hidden scrollbar-auto-hide px-5 pt-14"
        style={{ paddingBottom: scrollPaddingBottom ?? 40 }}
        ref={messagesContainerRef}
      >
        <div ref={messagesContentRef} className="space-y-8 max-w-2xl mx-auto">

          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <div className="flex items-center gap-2 text-sm text-muted">
                <div className="w-4 h-4 border-2 border-surface-border border-t-secondary rounded-full animate-spin" />
                <span>Loading earlier messages...</span>
              </div>
            </div>
          )}
          {hasMoreMessages && !isLoadingMore && (
            <div ref={loadMoreTriggerRef} className="h-1" />
          )}

          <AnimatePresence initial={true}>
            {messagesWithTurnIndex.map((message, index) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: message.role === "user" ? 15 : 0, scale: message.role === "user" ? 0.98 : 1 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={`group relative flex flex-col ${
                  message.role === "user" ? "items-end" : "items-start"
                } ${
                  // Reserve room below the final assistant message so its hover
                  // action bar (an absolute overlay) clears the "ready" line
                  // instead of crowding it. Margin sits AFTER the wrapper, so it
                  // moves the ready line down without moving the anchored bar.
                  message.role === "assistant" && index === messagesWithTurnIndex.length - 1
                    ? "mb-4"
                    : ""
                }`}
                {...(message.turnIndex !== undefined
                  ? { "data-turn-index": message.turnIndex }
                  : {})}
              >
                {message.role === "user" ? (
                  <UserMessage
                    message={message}
                    isEditing={editingMessageId === message.id}
                    editingContent={editingContent}
                    editTextareaRef={editTextareaRef}
                    isLoading={isLoading}
                    copiedMessageId={copiedMessageId}
                    ttsPlayingId={ttsPlayingId}
                    ttsLoadingId={ttsLoadingId}
                    ttsMenuId={ttsMenuId}
                    onEditChange={onEditChange}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={onCancelEdit}
                    onCopy={onCopy}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSpeak={onSpeak}
                    onSetTtsMenuId={onSetTtsMenuId}
                    onRegenerate={onRegenerate}
                    onContinue={onContinue}
                  />
                ) : (
                  <AssistantMessage
                    message={message}
                    isEditing={editingMessageId === message.id}
                    editingContent={editingContent}
                    editTextareaRef={editTextareaRef}
                    isLoading={isLoading}
                    isStreaming={isStreaming}
                    streamingContent={streamingContent}
                    streamingMessageId={streamingMessageId}
                    harnessSegments={harnessSegments}
                    streamToolCalls={streamToolCalls}
                    isLastAssistant={index === lastAssistantMessageIndex}
                    copiedMessageId={copiedMessageId}
                    ttsPlayingId={ttsPlayingId}
                    ttsLoadingId={ttsLoadingId}
                    ttsMenuId={ttsMenuId}
                    onEditChange={onEditChange}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={onCancelEdit}
                    onCopy={onCopy}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSpeak={onSpeak}
                    onSetTtsMenuId={onSetTtsMenuId}
                    onRegenerate={onRegenerate}
                    onContinue={onContinue}
                  />
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Persistent permission prompt */}
          <AnimatePresence>
            {pendingPermission && (
              <motion.div
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-start"
              >
                <div className="flex-1 mt-1">
                  <ToolPermissionCard
                    tool={pendingPermission}
                    onAllow={() => { onGrantPermission(pendingPermission); onDismissPermission(); }}
                    onDeny={onDismissPermission}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Pure streaming message (no streamingMessageId yet) */}
          {isStreaming && streamingContent && !streamingMessageId && (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex items-start"
            >
              <div className="flex-1 max-w-xl">
                <StreamingText content={streamingContent} showCursor={true} className="prose-chat" />
              </div>
            </motion.div>
          )}

          {/* The bottom status line renders inline here, right after the last message,
              like Claude.ai: on a short answer it sits wherever that lands (not
              glued to the composer); on a long/streaming answer the existing
              auto-scroll pin keeps it hugging the composer as content grows. */}
          {turnStatus && (
            <TurnStatus
              key={`turn-${turnStatus.convId ?? "new"}`}
              engine={turnStatus.engine}
              convId={turnStatus.convId}
              generating={turnStatus.generating}
              label={turnStatus.label}
              thinking={turnStatus.thinking}
              contextUsed={turnStatus.contextUsed}
              contextLimit={turnStatus.contextLimit}
            />
          )}

          <div ref={messagesEndRef} className="chat-scroll-anchor" />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 px-5 py-2">
          <div className="max-w-2xl mx-auto">
            <ErrorDisplay message={error} onDismiss={onClearError} />
          </div>
        </div>
      )}
    </div>
  );
};
