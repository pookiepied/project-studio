import { AskUserQuestionCard } from "@/features/chat/components/AskUserQuestionCard";
import type { ActiveToolCall, ToolApprovalDecision } from "@/features/chat/context/types";
import { ComposerApprovalCard } from "@/features/permissions";
import { ClaudeCodeIcon } from "@/ui/brand";
import { Button } from "@/ui/primitives/Button";

// Claude-owns-transcript banner: Claude Code brand-warm accent (Anthropic
// terracotta family, matches ClaudeCodeIcon #CC785C). Not a neutral surface;
// no design-token equivalent, so hex is intentional here.
/* eslint-disable no-restricted-syntax -- brand carve-out: Claude Code warm accent, no neutral-token equivalent */
const CLAUDE_TRANSCRIPT_BANNER =
  "mb-2 rounded-xl border border-[#E9D8CF] dark:border-[#3A2A22] bg-[#FFF8F4] dark:bg-[#241B17] px-3 py-2 shadow-sm";
const CLAUDE_FORK_BUTTON =
  "flex-shrink-0 rounded-lg border border-[#E3C8BA] dark:border-[#4A342A] bg-surface-page/80 dark:bg-[#2D211C] px-2.5 py-1 text-2xs font-medium text-secondary dark:text-disabled hover:bg-surface-page dark:hover:bg-[#352820] transition-colors";
/* eslint-enable no-restricted-syntax */

function pendingComposerApproval(activeToolCalls: ActiveToolCall[]) {
  return activeToolCalls.find((tc) =>
    tc.status === "pending_approval" &&
    tc.approvalKind !== "global_access" &&
    tc.approvalKind !== "mcp_management" &&
    tc.approvalKind !== "skill_management"
  ) ?? null;
}

export function PendingComposerInteractions({
  activeToolCalls,
  onApprovalDecision,
  onQuestionAnswer,
}: {
  activeToolCalls: ActiveToolCall[];
  onApprovalDecision: (decision: ToolApprovalDecision) => void;
  onQuestionAnswer: (answer: string) => void;
}) {
  const pendingQuestion = activeToolCalls.find((tc) => tc.status === "pending_question");

  return (
    <div className="[&:not(:empty)]:mb-2">
      <ComposerApprovalCard
        toolCall={pendingComposerApproval(activeToolCalls)}
        onDecision={onApprovalDecision}
      />
      {pendingQuestion ? (
        <AskUserQuestionCard
          key={pendingQuestion.callId}
          question={pendingQuestion.args.question as string}
          suggestions={pendingQuestion.args.suggestions as string[] | undefined}
          onAnswer={onQuestionAnswer}
        />
      ) : null}
    </div>
  );
}

export function ClaudeTranscriptNotice({
  onFork,
}: {
  onFork: () => void;
}) {
  return (
    <div className={CLAUDE_TRANSCRIPT_BANNER}>
      <div className="flex items-center gap-2">
        <ClaudeCodeIcon size={16} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-primary dark:text-disabled">
            Claude Code owns this transcript
          </p>
          <p className="text-2xs text-muted dark:text-muted">
            Continue with Claude to keep the native history intact, or fork a Studio-owned copy.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={onFork}
          className={CLAUDE_FORK_BUTTON}
        >
          Fork to Studio
        </Button>
      </div>
    </div>
  );
}
