import { useEffect, useRef, useState } from "react";
import {
  ArrowUpIcon as ArrowUp,
  ChatCircleTextIcon as ChatCircleText,
  XIcon as X,
} from "@phosphor-icons/react";
import { ChatProvider, useChat } from "@/features/chat/context";
import { ResizeHandle } from "@/features/workspace/rightWorkspace/ResizeHandle";

interface SideChatPanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

function SideChatContent({ width, onWidthChange, onClose }: SideChatPanelProps) {
  const drag = useRef<{ sx: number; sw: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const {
    createNewConversation,
    displayedMessages,
    sendMessage,
    isLoading,
    isStreaming,
    streamingContent,
  } = useChat();

  useEffect(() => {
    createNewConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [displayedMessages.length, streamingContent]);

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sw: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      // Cap at half the window so the chat side always keeps >=50% (rail + text
      // get crushed otherwise); never exceed 1000 or drop below 340.
      const maxW = Math.max(340, Math.min(1000, Math.round(window.innerWidth * 0.5)));
      onWidthChange(Math.max(340, Math.min(maxW, drag.current.sw + (drag.current.sx - ev.clientX))));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading || isStreaming) return;
    setInput("");
    await sendMessage(text, true);
  };

  const messages = displayedMessages;

  return (
    <div className="flex h-full transition-colors duration-300" style={{ width, minWidth: width }}>
      <ResizeHandle onMouseDown={onResizeDown} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-surface-page">
        <div className="flex h-10 flex-shrink-0 items-center gap-2.5 border-b border-gray-100 bg-white px-3 transition-colors duration-300 dark:border-white/[0.06] dark:bg-surface-page">
          <button
            type="button"
            onClick={onClose}
            title="Close side chat"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-300"
          >
            <X size={13} weight="bold" />
          </button>
          <ChatCircleText size={13} weight="regular" className="flex-shrink-0 text-gray-400 dark:text-gray-600" />
          <span className="truncate text-xs text-gray-500 dark:text-gray-500">Side chat</span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !streamingContent ? (
            <div className="flex h-full items-center justify-center text-center">
              <div className="max-w-[220px]">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 dark:border-surface-border dark:bg-surface-raised dark:text-gray-500">
                  <ChatCircleText size={17} weight="regular" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">New side chat</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400 dark:text-gray-600">
                  Ask without leaving the main conversation.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "ml-8 bg-gray-100 text-gray-800 dark:bg-surface-raised dark:text-gray-200"
                      : "mr-8 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {message.content}
                </div>
              ))}
              {streamingContent && (
                <div className="mr-8 rounded-lg px-3 py-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {streamingContent}
                </div>
              )}
            </div>
          )}
        </div>

        <form onSubmit={submit} className="flex-shrink-0 border-t border-gray-100 bg-white p-3 dark:border-white/[0.06] dark:bg-surface-page">
          <div className="flex items-end gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 dark:border-white/[0.08] dark:bg-surface-raised">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask side chat"
              rows={1}
              className="max-h-28 min-h-6 flex-1 resize-none bg-transparent text-sm leading-5 text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-600"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading || isStreaming}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white transition-opacity disabled:opacity-35 dark:bg-gray-100 dark:text-gray-900"
              title="Send"
            >
              <ArrowUp size={13} weight="bold" />
            </button>
          </div>
        </form>
      </div>
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
