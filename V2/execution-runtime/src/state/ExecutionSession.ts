import {
  RuntimeSession,
  type LoopResult,
  type RuntimeProfile,
} from "@studio/v2-runtime";
import type { RunState } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * The Execution Runtime's session: the general-purpose agent that executes a
 * user's task directly. It is the shared engine (RuntimeSession) with:
 *
 * - the "execution" consumer profile,
 * - no tool gating (it may use every capability Studio Context exposes), and
 * - a finalize hook that hands the completed transcript to Studio Data.
 *
 * Everything hard — the durable state machine, checkpoints, idempotency,
 * approvals, recovery, the WebSocket protocol — comes from the base class.
 */
export class ExecutionSession extends RuntimeSession<Env> {
  protected readonly profile: RuntimeProfile = {
    consumer: "execution",
    fallbackSystemPrompt:
      "You are Studio, a capable general-purpose assistant. Be direct and helpful.",
  };

  /**
   * Minimal Studio Data handoff. This intentionally does not freeze the final
   * transcript/archive format — we persist the stable basics (conversation
   * metadata, the user request, the final assistant output). A persistence
   * failure must not fail an otherwise-completed run, so it is reported as
   * progress rather than thrown.
   */
  protected override async finalize(run: RunState, result: LoopResult): Promise<string> {
    try {
      await this.postData("/conversations", run.userId, {
        id: run.conversationId,
        title: titleFromRequest(run.request),
      });
      await this.postData(
        `/conversations/${encodeURIComponent(run.conversationId)}/messages`,
        run.userId,
        { id: `msg_${run.turnId}_user`, role: "user", content: run.request },
      );
      await this.postData(
        `/conversations/${encodeURIComponent(run.conversationId)}/messages`,
        run.userId,
        { id: `msg_${run.turnId}_assistant`, role: "assistant", content: result.text },
      );
    } catch (error) {
      await this.emit(run, "run.progress", {
        message: `Studio Data persistence failed: ${describe(error)}`,
      });
    }
    return result.text;
  }
}

function titleFromRequest(request: string): string {
  const compact = request.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled conversation";
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
