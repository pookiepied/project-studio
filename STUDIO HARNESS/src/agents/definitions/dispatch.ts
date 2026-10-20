import { dispatch, type DeliveredMessageInput } from "@flue/runtime";

import { agentRegistry } from "./index.js";
import { AgentRegistryError } from "./registry.js";
import type { TaskStore } from "./task-store.js";
import { observeOperation } from "../../observability/operation.js";
import { currentExecutionContext } from "../../execution/context.js";
import { forgetProvisionalInvocation, rememberInvocation } from "../../observability/invocations.js";
import { createObservationWriter } from "../../observability/recorder.js";

/**
 * The one in-process dispatcher for background agents (ADR 0058 D5).
 *
 * Three modules — the titling orchestrator, the text improver, the image
 * describer — each carried the same handful of lines: resolve the agent,
 * `dispatch(Agent, { id, message })`, and let the observation bus carry the
 * answer back. This is those lines, stated once, with the registry now
 * between the caller and the agent function so a dispatch cannot name an
 * agent the harness does not know it has.
 *
 * Since Stage 4 it is also the place a dispatch becomes a product surface:
 * every dispatch records its row in the TaskStore — the index the rail's
 * Tasks section reads and the settlement projector settles — before the
 * submission is admitted, and links the receipt's submission id afterwards.
 * The order is deliberate and each half has its own failure story: a row
 * written before admission means a run that starts is always indexed (the
 * rail never shows work the harness is doing with no row to show it in), and
 * a dispatch that is then refused leaves the row settled `failed` with why —
 * the same story a process job that fails to spawn tells, not a missing row
 * pretending nothing was attempted.
 *
 * Deliberately fire-and-forget in shape (the receipt's submissionId is
 * returned for callers that want it; the titler does not read it, and Flue
 * rejects at admission rather than here for an unknown target). The
 * observation-bus wait that each orchestrator builds around its own take-id
 * vocabulary stays where it is — that logic is per-agent (a ladder, a
 * promise, a proposal), and sharing it would be the wrong consolidation.
 *
 * **No idempotency key, and that is the recorded decision (S4.5, ADR 0033).**
 * ADR 0033's conservative rule bars automatic resend, and every caller here
 * dispatches exactly once per user-visible action; a replayed *settlement*
 * (recovery re-observing an ending) finds the row already settled and
 * re-dispatches nothing, which the projector's replay test proves. The
 * reopen condition, named where it will be read again: **any path that
 * resends a submission automatically** — a scheduler, an outbox, a reconnect
 * queue — must carry Flue's idempotency key on the resend, and with the key
 * comes attempt attribution, which is what `createRetryExecutionContext` was
 * deleted for lacking. Until such a path exists there is nothing here to
 * retry, and the key stays declined.
 */
export interface BackgroundTaskContext {
  /**
   * The task index the row is recorded into. The same store the routes and
   * the projector read — one table, one truth about what the harness has
   * dispatched.
   */
  readonly tasks: TaskStore;
  /**
   * The conversation this task's news belongs to, when it has one.
   *
   * This is the settlement signal's address, not bookkeeping: the projector
   * announces a settled task to this conversation through the JobPings hub,
   * and only when this is named — the background three's results reach their
   * callers directly (a held promise, a written title), so announcing them
   * would wake a conversation with news it already has. The first caller
   * with genuinely conversation-owned background work names it, and the
   * signal path is already built and tested for it.
   */
  readonly parentConversationId?: string | undefined;
  /** The rail row's label, when the caller has a better one than the title. */
  readonly title?: string | undefined;
  /** Diagnostic scope only; does not announce task results or grant authority. */
  readonly diagnosticConversationId?: string;
}

export async function dispatchBackgroundAgent(
  agentName: string,
  id: string,
  message: DeliveredMessageInput,
  context: BackgroundTaskContext,
): Promise<string> {
  return observeOperation("subagent", "background.dispatch", async () => {
    const execution = currentExecutionContext();
    const conversationId = context.diagnosticConversationId ?? context.parentConversationId;
    const record = createObservationWriter();
    const registered = agentRegistry.get(agentName);
    if (registered === undefined || (registered.definition.kind !== "background" && registered.definition.kind !== "worker")) {
      // Names are pinned literals shared with the caller's module, so this is
      // a build-time authoring failure showing up at dispatch time - the
      // registry's own error vocabulary, not a generic "unknown agent".
      throw new AgentRegistryError(
        "invalid",
        `No background agent named "${agentName}" is registered.`,
        { agentName },
      );
    }
    // Before the dispatch, deliberately: the row is the index of work attempted,
    // and recording after the receipt would lose every task whose process died
    // between admission and receipt - the one crash the durable submission
    // survives and an after-the-fact row would not.
    context.tasks.record({
      id,
      agentName,
      ...(context.parentConversationId === undefined
        ? {}
        : { parentConversationId: context.parentConversationId }),
      ...(context.title === undefined ? {} : { title: context.title }),
    });
    const linkSubmission = execution === undefined ? undefined : rememberInvocation(agentName, id, execution, conversationId);
    try {
      const receipt = await dispatch(registered.agent, { id, message });
      linkSubmission?.(receipt.submissionId, receipt.deduplicated === true);
      record({ name: "background.admitted", phase: "end", outcome: "completed",
        identity: { agentName, agentInstanceId: id, submissionId: receipt.submissionId,
          ...(execution === undefined ? {} : { invocationId: execution.operationId }),
          ...(conversationId === undefined ? {} : { conversationId }) } });
      context.tasks.setOriginSubmission(id, receipt.submissionId);
      return receipt.submissionId;
    } catch (error) {
      // The dispatch was refused - runtime not configured, target unavailable,
      // process shutting down. The row exists because it was written first, so
      // the failure it indexes is settled here, with the reason the rail can
      // show; the error itself continues to the caller, which has its own
      // handling (the titler logs and ends its ladder, the improver rejects).
      context.tasks.setStatus(
        id,
        "failed",
        `The task never started: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      if (execution !== undefined) forgetProvisionalInvocation(execution.operationId);
    }
  }, { agentName, agentInstanceId: id }, context.diagnosticConversationId ?? context.parentConversationId);
}
