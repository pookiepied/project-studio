import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowClockwiseIcon as ArrowClockwise,
  MagnifyingGlassIcon as MagnifyingGlass,
  SparkleIcon as Sparkle,
} from "@phosphor-icons/react";
import { AssistantMessage } from "@/features/chat/components/AssistantMessage";
import { ChatComposer } from "@/features/chat/components/ChatComposer";
import { UserMessage } from "@/features/chat/components/UserMessage";
import { ArtifactRenderer } from "@/features/markdown";
import { useSettings } from "../contexts/SettingsContext";
import type { ChatMessage } from "../types";
import type { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";

const SEARCH_ARTIFACT = {
  type: "artifact",
  version: 1,
  category: "general",
  kind: "web_search",
  title: "Search: best places to visit in Japan",
  summary: "Found 5 results.",
  status: "success",
  presentation: {
    surface: "chat",
    density: "card",
    compactLabel: "Web search",
  },
  source: {
    server: "studio-tools",
    tool: "web_search",
  },
  meta: {
    query: "best places to visit in Japan",
  },
  sections: [
    {
      type: "links",
      items: [
        {
          label: "Top 20 Places to Visit in Japan — Lonely Planet",
          href: "https://www.lonelyplanet.com/articles/best-places-to-visit-in-japan",
          description: "From the neon streets of Tokyo to the ancient temples of Kyoto, Japan offers a stunning range of experiences for every traveler.",
        },
        {
          label: "The 15 Best Places to Visit in Japan — Travel + Leisure",
          href: "https://www.travelandleisure.com/trip-ideas/japan-travel/best-places-to-visit-in-japan",
          description: "Tokyo, Osaka, Hiroshima, and beyond — these are the spots that make Japan one of the world's most rewarding destinations.",
        },
        {
          label: "Japan Travel Guide — Japan National Tourism Organization",
          href: "https://www.japan.travel/en/",
          description: "Official travel guide featuring must-see destinations, seasonal highlights, and practical travel information.",
        },
        {
          label: "Best Time to Visit Japan and Top Destinations — CNN Travel",
          href: "https://edition.cnn.com/travel/article/best-places-visit-japan",
          description: "Cherry blossoms in spring, fiery foliage in autumn — timing your trip to Japan makes all the difference.",
        },
        {
          label: "Hidden Gems in Japan Beyond Tokyo and Kyoto — Atlas Obscura",
          href: "https://www.atlasobscura.com/things-to-do/japan",
          description: "Venture beyond the well-trodden path to discover Yakushima's ancient forests, Kanazawa's preserved samurai districts, and more.",
        },
      ],
    },
  ],
};

const SEARCH_ARTIFACT_MARKDOWN = `Here are the results I found for that query.\n\n\`\`\`artifact\n${JSON.stringify(SEARCH_ARTIFACT, null, 2)}\n\`\`\``;

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "tmp-assistant-welcome",
    role: "assistant",
    timestamp: Date.now(),
    content: "Temporary artifact page.\n\nAsk me to search for something and I will render a fake web search widget inline so we can shape the visual language before wiring live tool output.",
  },
];

function buildAssistantReply(input: string): string {
  const normalized = input.toLowerCase();
  if (normalized.includes("search") || normalized.includes("find") || normalized.includes("look up") || normalized.includes("japan")) {
    return SEARCH_ARTIFACT_MARKDOWN;
  }

  return "This temporary page is focused on artifact previews. Try asking me to search for something so we can shape the web search widget.";
}

export const TemporaryPage = () => {
  const { settings, updateSettings } = useSettings();
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [inputMessage, setInputMessage] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);

  const latestArtifactCode = useMemo(() => JSON.stringify(SEARCH_ARTIFACT, null, 2), []);

  const appendTurn = (text: string) => {
    const now = Date.now();
    const userMessage: ChatMessage = {
      id: `tmp-user-${now}`,
      role: "user",
      timestamp: now,
      content: text,
    };
    const assistantMessage: ChatMessage = {
      id: `tmp-assistant-${now}`,
      role: "assistant",
      timestamp: now + 1,
      content: buildAssistantReply(text),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInputMessage("");
    setAttachments([]);
    requestAnimationFrame(() => {
      messageScrollRef.current?.scrollTo({
        top: messageScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  };

  const handleSend = () => {
    const trimmed = inputMessage.trim();
    if (!trimmed) return;
    appendTurn(trimmed);
  };

  return (
    <div className="flex h-full flex-col bg-white text-gray-900 dark:bg-surface-page dark:text-gray-100">
      <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-surface-divider">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Temporary Page</p>
          <h1 className="mt-1 font-display text-xl text-gray-900 dark:text-gray-100">Artifact Chat Sandbox</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            A fake conversation for shaping artifacts in-context before we wire real tool calls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMessages(INITIAL_MESSAGES);
              setInputMessage("");
              setAttachments([]);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-surface-border dark:bg-surface-base dark:text-gray-300 dark:hover:bg-surface-raised"
          >
            <ArrowClockwise size={12} />
            Reset chat
          </button>
          <button
            type="button"
            onClick={() => appendTurn("Search for the best places to visit in Japan")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <MagnifyingGlass size={12} weight="bold" />
            Trigger search
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
        <main className="relative min-w-0 overflow-hidden">
          <div
            ref={messageScrollRef}
            className="h-full overflow-y-auto px-5 pt-6 pb-40"
          >
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
              {messages.map((message, index) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className={`group relative flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
                >
                  {message.role === "user" ? (
                    <UserMessage
                      message={message}
                      isEditing={false}
                      editingContent=""
                      editTextareaRef={{ current: null }}
                      isLoading={false}
                      copiedMessageId={null}
                      ttsPlayingId={null}
                      ttsLoadingId={null}
                      ttsMenuId={null}
                      toolsPopupId={null}
                      toolCalls={null}
                      onEditChange={() => {}}
                      onSaveEdit={() => {}}
                      onCancelEdit={() => {}}
                      onCopy={() => {}}
                      onEdit={() => {}}
                      onDelete={() => {}}
                      onSpeak={() => {}}
                      onSetTtsMenuId={() => {}}
                      onSetToolsPopupId={() => {}}
                      onRegenerate={() => {}}
                      onContinue={() => {}}
                    />
                  ) : (
                    <AssistantMessage
                      message={message}
                      isEditing={false}
                      editingContent=""
                      editTextareaRef={{ current: null }}
                      isLoading={false}
                      isStreaming={false}
                      streamingContent=""
                      streamingMessageId={null}
                      harnessSegments={[]}
                      streamToolCalls={[]}
                      isLastAssistant={index === messages.length - 1}
                      copiedMessageId={null}
                      ttsPlayingId={null}
                      ttsLoadingId={null}
                      ttsMenuId={null}
                      toolsPopupId={null}
                      toolCalls={null}
                      onEditChange={() => {}}
                      onSaveEdit={() => {}}
                      onCancelEdit={() => {}}
                      onCopy={() => {}}
                      onEdit={() => {}}
                      onDelete={() => {}}
                      onSpeak={() => {}}
                      onSetTtsMenuId={() => {}}
                      onSetToolsPopupId={() => {}}
                      onRegenerate={() => {}}
                      onContinue={() => {}}
                    />
                  )}
                </motion.div>
              ))}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
            <div className="bg-gradient-to-t from-white via-white to-transparent px-5 pb-7 pt-12 dark:from-surface-page dark:via-surface-page">
              <div className="pointer-events-auto mx-auto max-w-2xl">
                <ChatComposer
                  inputMessage={inputMessage}
                  attachments={attachments}
                  inputRef={inputRef}
                  attachMenuRef={attachMenuRef}
                  showAttachMenu={showAttachMenu}
                  isLoading={false}
                  isStreaming={false}
                  currentModel="temporary-artifact-mode"
                  chatEngine="studio"
                  claudeModel="sonnet"
                  customModelName="Temporary Artifact Mode"
                  modelsLoading={false}
                  reasoningBudget={undefined}
                  settings={settings}
                  projectContext={null}
                  recentFiles={[]}
                  onInputChange={(event) => setInputMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  onSend={handleSend}
                  onAbort={() => {}}
                  onToggleAttachMenu={() => setShowAttachMenu((prev) => !prev)}
                  onTriggerFileInput={() => {}}
                  onSelectRecentFile={() => {}}
                  onAttachmentsChange={setAttachments}
                  onToggleAutopilot={() => updateSettings({ autopilotMode: !settings.autopilotMode })}
                  onChatEngineChange={() => {}}
                  onSelectModel={() => {}}
                  onClaudeModelChange={() => {}}
                  onOpenLibrary={() => {}}
                  onTranscript={(text) => setInputMessage((prev) => (prev ? `${prev} ${text}` : text))}
                  onReasoningChange={() => {}}
                  onAddFiles={() => {}}
                  claudePermissionMode="default"
                  claudeEffortLevel="medium"
                  onClaudePermissionModeChange={() => {}}
                  onClaudeEffortLevelChange={() => {}}
                />
              </div>
            </div>
          </div>
        </main>

        <aside className="border-l border-gray-100 bg-gray-50/50 p-5 dark:border-surface-divider dark:bg-white/[0.02]">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-surface-border dark:bg-surface-base">
            <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
              <Sparkle size={12} />
              Current focus
            </div>
            <h2 className="mt-3 text-sm font-medium text-gray-800 dark:text-gray-200">Web search artifact</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              This sidebar stays simple on purpose. The real review happens in the fake conversation, while this pane gives us a clean single-artifact reference.
            </p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-surface-border">
              <ArtifactRenderer code={latestArtifactCode} />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-surface-border dark:bg-surface-base">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">How to use</p>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              <p>Ask for a search in the composer and the assistant will emit the widget inline in the conversation.</p>
              <p>We can now refine spacing, tone, density, and result row behavior in a realistic chat layout.</p>
              <p>Once the design feels right, we can move the same rendering into the real tool flow and remove this page.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
