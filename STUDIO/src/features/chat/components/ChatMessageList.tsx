import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StreamingText } from "@/features/chat/components/StreamingMarkdown";
import { ErrorDisplay } from "@/ui/feedback/ErrorDisplay";
import { ToolPermissionCard } from "@/runtime";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { getTurnAnchorIndices } from "@/lib/turnAnchors";
import { TurnStatus } from "./idle/TurnStatus";
import type { ChatMessage, MessageSegment } from "@/types";
import type { ActiveToolCall } from "@/features/chat/context/types";
import type { ChatEngine } from "@/cliBridges/types";

/**
 * Human phrase for the status line while a specific tool is running. Keeps the
 * live state honest ("Searching the web" instead of a generic "Working") and
 * gives the surface a bit of personality. Order matters — first match wins.
 */
function toolPhrase(tool: string): string {
  const t = tool.toLowerCase();
  if (t.startsWith("memory")) return "Recalling memory";
  if (t.includes("web_search")) return "Searching the web";
  if (t.includes("web_fetch") || t.includes("http") || t.includes("browse")) return "Browsing the web";
  if (t.includes("write") || t.includes("edit") || t.includes("create")) return "Editing files";
  if (t.includes("read") || t.includes("grep") || t.includes("glob") || t.includes("file_search") || t.includes("cat")) return "Reading files";
  if (t === "bash" || t === "powershell" || t.includes("terminal") || t.includes("shell") || t.includes("command")) return "Running commands";
  if (t.includes("image")) return "Generating an image";
  if (t.includes("video")) return "Generating video";
  if (t.includes("agent") || t.includes("spawn")) return "Delegating to an agent";
  if (t.includes("rag") || t.includes("doc")) return "Searching your docs";
  if (t.startsWith("mcp")) return "Using a connected tool";
  return "Working";
}

interface ChatMessageListProps {
  // Messages
  messages:           ChatMessage[];
  isLoadingMore:      boolean;
  hasMoreMessages:    boolean;
  // Scroll refs — provided by useChatScroll
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef:       React.RefObject<HTMLDivElement | null>;
  messagesContentRef:   React.RefObject<HTMLDivElement | null>;
  loadMoreTriggerRef:   React.RefObject<HTMLDivElement | null>;
  // Streaming
  isLoading:            boolean;
  isStreaming:          boolean;
  streamingContent:     string;
  streamingMessageId:   string | null;
  thinkingContent:      string;
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
  toolsPopupId:         string | null;
  getMessageToolCalls:  (id: string) => string[] | null;
  onCopy:               (content: string, id: string) => void;
  onEdit:               (id: string, content: string) => void;
  onDelete:             (id: string) => void;
  onSpeak:              (id: string, content: string) => void;
  onSetTtsMenuId:       (id: string | null) => void;
  onSetToolsPopupId:    (id: string | null) => void;
  onRegenerate:         () => void;
  onContinue:           () => void;
  // Permission
  pendingPermission:    string | null;
  onGrantPermission:    (tool: string) => void;
  onDismissPermission:  () => void;
  // Error
  error:                string | null;
  onClearError:         () => void;
  // Floating composer — bottom padding so the last message clears the overlay
  scrollPaddingBottom?: number;
  // Active engine — drives the idle "ready" indicator's animation + label
  chatEngine:           ChatEngine;
  // Current conversation id — keys the persisted generation timer
  convId?:              string;
  // Conversation token footprint (tokenizer estimate — fallback only)
  contextTokens?:       number;
  // Real context-window occupancy from model usage (preferred; 0 = unknown)
  usageContextTokens?:  number;
  // Model context-window limit — denominator for the fullness meter
  contextLimit?:        number;
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
  thinkingContent,
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
  toolsPopupId,
  getMessageToolCalls,
  onCopy,
  onEdit,
  onDelete,
  onSpeak,
  onSetTtsMenuId,
  onSetToolsPopupId,
  onRegenerate,
  onContinue,
  pendingPermission,
  onGrantPermission,
  onDismissPermission,
  error,
  onClearError,
  scrollPaddingBottom,
  chatEngine,
  convId,
  contextTokens,
  usageContextTokens,
  contextLimit,
}: ChatMessageListProps) => {
  // Real usage only — the tokenizer estimate can't see the system prompt, tools,
  // or file-read results, so showing it as truth is misleading. When there's no
  // real number yet (a fresh turn, or the Studio engine which doesn't report
  // usage) the meter renders nothing rather than a wrong figure.
  const contextUsed = usageContextTokens && usageContextTokens > 0 ? usageContextTokens : undefined;
  void contextTokens; // retained as a prop for pre-send pruning; not shown here
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
        className="chat-scroll-container flex-1 overflow-y-auto overflow-x-hidden scrollbar-auto-hide px-5 pt-10"
        style={{ paddingBottom: scrollPaddingBottom ?? 40 }}
        ref={messagesContainerRef}
      >
        <div ref={messagesContentRef} className="space-y-6 max-w-2xl mx-auto">

          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
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
                    toolsPopupId={toolsPopupId}
                    toolCalls={getMessageToolCalls(message.id)}
                    onEditChange={onEditChange}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={onCancelEdit}
                    onCopy={onCopy}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSpeak={onSpeak}
                    onSetTtsMenuId={onSetTtsMenuId}
                    onSetToolsPopupId={onSetToolsPopupId}
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
                    toolsPopupId={toolsPopupId}
                    toolCalls={getMessageToolCalls(message.id)}
                    onEditChange={onEditChange}
                    onSaveEdit={onSaveEdit}
                    onCancelEdit={onCancelEdit}
                    onCopy={onCopy}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSpeak={onSpeak}
                    onSetTtsMenuId={onSetTtsMenuId}
                    onSetToolsPopupId={onSetToolsPopupId}
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

          {/* Bottom status — ONE persistent line for the whole conversation.
              It morphs between the live turn state (glyph + phase + elapsed timer
              + context) and the idle "ready for your next task" line without ever
              unmounting, so it can't flicker/reprovision on phase hand-offs.
              Keyed by conversation so switching chats remounts cleanly.
              Suppressed while a permission prompt owns the surface. */}
          {pendingPermission ? null : messages.length > 0 ? (
            <TurnStatus
              key={`turn-${convId ?? "new"}`}
              engine={chatEngine}
              convId={convId}
              generating={isLoading || isStreaming || !!streamingMessageId}
              label={(() => {
                // A running tool wins (most specific). Otherwise it's "Responding"
                // only when real text is streaming — NOT merely because a
                // streamingMessageId exists (that's set at turn start, before any
                // output, which is why it used to say "Responding" while thinking).
                const runningTool = activeToolCalls.find(
                  (tc) => tc.status === "running" && !tc.parentCallId
                );
                if (runningTool) return toolPhrase(runningTool.tool);
                if (streamingContent && streamingContent.length > 0) return "Responding";
                return "Thinking";
              })()}
              thinking={thinkingContent}
              contextUsed={contextUsed}
              contextLimit={contextLimit}
            />
          ) : null}

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
