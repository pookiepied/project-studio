import type { ReactNode, RefObject } from "react";
import type {
  ActiveToolCall,
  PendingMessage,
  ToolApprovalDecision,
} from "@/features/chat/context/types";
import { PendingMessageQueue } from "@/features/chat/components/PendingMessageQueue";
import { ConnectionStatusBar } from "@/features/chat/components/ConnectionStatusBar";
import { ClaudeTranscriptNotice, PendingComposerInteractions } from "./ChatComposerPanels";

interface ChatConversationComposerDockProps {
  dockRef: RefObject<HTMLDivElement | null>;
  onWheelDelta: (deltaY: number) => void;
  isClaudeOwnedConversation: boolean;
  onForkConversation: () => void;
  pendingMessages: PendingMessage[];
  onCancelPendingMessage: (index: number) => void;
  conversationId?: string;
  activeToolCalls: ActiveToolCall[];
  onApprovalDecision: (decision: ToolApprovalDecision) => void;
  onQuestionAnswer: (answer: string) => void;
  composer: ReactNode;
}

export function ChatConversationComposerDock({
  dockRef,
  onWheelDelta,
  isClaudeOwnedConversation,
  onForkConversation,
  pendingMessages,
  onCancelPendingMessage,
  conversationId,
  activeToolCalls,
  onApprovalDecision,
  onQuestionAnswer,
  composer,
}: ChatConversationComposerDockProps) {
  return (
    <div
      ref={dockRef}
      className="absolute bottom-0 inset-x-0 z-20 pointer-events-none"
      onWheel={(event) => onWheelDelta(event.deltaY)}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-white to-transparent dark:from-surface-page" />
      <div className="pointer-events-none absolute inset-0 bg-surface-page" />
      <div className="relative px-5 pt-3 pb-5">
        <div className="max-w-2xl mx-auto relative pointer-events-auto">
          {isClaudeOwnedConversation && (
            <ClaudeTranscriptNotice onFork={onForkConversation} />
          )}

          <PendingMessageQueue
            messages={pendingMessages}
            onCancel={onCancelPendingMessage}
          />

          <ConnectionStatusBar convId={conversationId} />

          <PendingComposerInteractions
            activeToolCalls={activeToolCalls}
            onApprovalDecision={onApprovalDecision}
            onQuestionAnswer={onQuestionAnswer}
          />

          {composer}
        </div>
      </div>
    </div>
  );
}
