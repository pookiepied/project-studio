import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Conversation,
  Add,
} from "@/ui/icons";
import { ChatProvider, useChat } from "@/features/chat/context";
import { StreamingText } from "@/features/chat/components/StreamingMarkdown";
import { useConversationsList } from "@/features/chat/hooks/useConversationsList";
import { markdownComponents } from "@/features/markdown";
import { formatDate } from "@/lib/formatters";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { SearchInput } from "@/ui/primitives";
import { Textarea } from "@/ui/primitives/Textarea";

interface SideChatPanelProps {
  initialConversationId?: string | null;
  onConversationChange?: (conversationId: string | null, title?: string) => void;
}

const MemoizedMarkdown = memo(({ content }: { content: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
    {content}
  </ReactMarkdown>
));

function SideChatContent({ initialConversationId, onConversationChange }: SideChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onConversationChangeRef = useRef(onConversationChange);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(!initialConversationId);
  const {
    conversation,
    createNewConversation,
    loadConversationById,
    displayedMessages,
    sendMessage,
    isLoading,
    isStreaming,
    streamingContent,
    error,
    clearError,
  } = useChat();

  const { conversations, reload } = useConversationsList();

  useEffect(() => {
    onConversationChangeRef.current = onConversationChange;
  }, [onConversationChange]);

  useEffect(() => {
    if (initialConversationId) {
      loadConversationById(initialConversationId).catch(() => {});
    } else {
      createNewConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  useEffect(() => {
    onConversationChangeRef.current?.(conversation?.id ?? null, conversation?.title);
  }, [conversation?.id, conversation?.title]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [displayedMessages.length, streamingContent]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [input]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conv) =>
      `${conv.title} ${conv.projectName ?? ""} ${conv.storageScope ?? ""}`.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading || isStreaming) return;
    setInput("");
    await sendMessage(text, true);
    reload().catch(() => {});
  };

  const startNew = async () => {
    await createNewConversation();
    setSelectorOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-page">
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-surface-divider px-3">
        <Conversation size="sm" className="text-muted" />
        <Button
          variant="ghost"
          onClick={() => setSelectorOpen((value) => !value)}
          className="min-w-0 flex-1 justify-start truncate px-0 py-0 h-auto text-left text-xs font-medium text-primary hover:bg-transparent hover:text-secondary"
        >
          {conversation?.title ?? "Side chat"}
        </Button>
        <IconButton
          aria-label="New side chat"
          variant="ghost"
          size="sm"
          onClick={startNew}
          className="text-muted"
        >
          <Add size="sm" />
        </IconButton>
      </div>

      {selectorOpen && (
        <div className="flex-shrink-0 border-b border-surface-divider p-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            aria-label="Search conversations"
            placeholder="Search conversations"
            size="md"
            className="mb-2 rounded-xl text-xs"
          />
          <Button
            variant="ghost"
            leftIcon={<Add size="sm" />}
            onClick={startNew}
            className="mb-1 w-full h-8 justify-start px-2.5 text-left text-xs text-primary hover:bg-surface-hover"
          >
            Start new conversation
          </Button>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((conv) => (
              <Button
                key={conv.id}
                variant="ghost"
                onClick={() => {
                  loadConversationById(conv.id).catch(() => {});
                  setSelectorOpen(false);
                }}
                className={`mb-1 w-full justify-start rounded-lg px-2.5 py-2 h-auto flex-col items-start gap-0 text-left hover:bg-surface-hover ${
                  conv.id === conversation?.id ? "bg-surface-selected" : ""
                }`}
              >
                <p className="truncate text-xs font-medium text-primary">{conv.title}</p>
                <p className="mt-0.5 truncate text-2xs text-muted">
                  {conv.projectName ?? conv.storageScope ?? "Conversation"} · {formatDate(conv.updatedAt)}
                </p>
              </Button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-5 text-center text-xs text-muted">No conversations found.</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 border-b border-surface-divider px-3 py-2 text-xs text-muted">
          <Button variant="ghost" onClick={clearError} className="mr-2 px-0 py-0 h-auto justify-start text-xs font-medium text-primary hover:bg-transparent">Dismiss</Button>
          {error}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">
        {displayedMessages.length === 0 && !streamingContent ? (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-[220px]">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-base text-muted">
                <Conversation size="lg" />
              </div>
              <p className="text-sm font-semibold text-primary">Independent side chat</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Start a separate thread without changing the main conversation.
              </p>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            {displayedMessages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex min-w-0 justify-end pl-8">
                  <div className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-surface-selected px-3 py-2 text-sm leading-relaxed text-primary [overflow-wrap:anywhere]">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="min-w-0 max-w-full overflow-hidden text-sm text-secondary">
                  <div className="prose-chat min-w-0 max-w-full [overflow-wrap:anywhere]">
                    <MemoizedMarkdown content={message.content} />
                  </div>
                </div>
              ),
            )}
            {streamingContent && (
              <div className="min-w-0 max-w-full overflow-hidden text-sm text-secondary">
                <StreamingText
                  content={streamingContent}
                  showCursor={isStreaming}
                  className="prose-chat min-w-0 max-w-full [overflow-wrap:anywhere]"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex-shrink-0 border-t border-surface-divider bg-surface-page p-3">
        <div className="flex min-w-0 items-end gap-2 rounded-lg border border-surface-border bg-surface-base px-3 py-2 shadow-sm transition-colors focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/15">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask side chat"
            aria-label="Message side chat"
            rows={1}
            className="w-auto max-h-28 min-h-6 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent py-0.5 text-sm leading-5 scrollbar-thin"
          />
          <IconButton
            type="submit"
            aria-label="Send"
            variant="emphasis"
            size="sm"
            disabled={!input.trim() || isLoading || isStreaming}
            className="flex-shrink-0 rounded-md transition-[opacity,transform] hover:bg-primary hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-35"
          >
            <Send size="sm" />
          </IconButton>
        </div>
      </form>
    </div>
  );
}

export function SideChatPanel(props: SideChatPanelProps) {
  return (
    <ChatProvider>
      <SideChatContent {...props} />
    </ChatProvider>
  );
}
