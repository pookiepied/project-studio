import { dispatch } from "@flue/runtime";
import { agentRegistry } from "./definitions/index.js";
import type { AgentTaskRecord } from "./definitions/task-store.js";
import { isSettledTaskStatus } from "../contracts/agents.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import { observeOperation } from "../observability/operation.js";
import { currentExecutionContext } from "../execution/context.js";
import { forgetProvisionalInvocation, rememberInvocation } from "../observability/invocations.js";
import { createObservationWriter } from "../observability/recorder.js";

/**
 * Who is asking through `task_activity`, which decides what it may do.
 *
 * The voice agent's corrections must carry the user's exact words, which only
 * `voice_work` has, and a voice task's worker must not steer its siblings. So
 * both read and never steer here. Offering an action the role then refuses
 * is what sent the voice model to the wrong tool first: the schema itself is
 * the routing.
 */
export type TaskCoordinationRole = "conversation" | "voice" | "worker";

export function taskActivitySurface(role: TaskCoordinationRole): {
  readonly actions: readonly ["status", "inspect"] | readonly ["status", "inspect", "steer", "cancel"];
  readonly description: string;
} {
  const read = "status lists this conversation's delegates and workers with their live stage. inspect reads one task's recent steps - what it said, its tool calls and their results, bounded and without private reasoning - either the latest few, or only what followed `after` (the cursor a previous inspect returned). Reading never re-runs or resends anything.";
  if (role === "conversation") {
    return { actions: ["status", "inspect", "steer", "cancel"], description: `${read} steer and cancel reach independently addressable workers only; inline task delegates can be inspected but not steered. A correction is not permission to bypass approval.` };
  }
  return {
    actions: ["status", "inspect"],
    description: role === "voice"
      ? `${read} Read-only: steer or cancel a voice task with voice_work, which carries the user's exact words.`
      : `${read} Read-only: this task cannot steer or cancel other tasks.`,
  };
}

/** Existing durable workers accept corrections without starting another worker. */
export async function steerTask(task: AgentTaskRecord, text: string, admissionKey?: string): Promise<string> {
  return observeOperation("subagent", "task.steer", async () => {
    const execution = currentExecutionContext();
    const record = createObservationWriter();
    if (isSettledTaskStatus(task.status)) throw new ProviderConfigurationError("That task has finished. Start a continuation instead.");
    const registered = agentRegistry.get(task.agentName);
    if (registered === undefined || text.trim() === "" || text.length > 16_000) {
      throw new ProviderConfigurationError("A task correction must contain between 1 and 16000 characters.");
    }
    const message = { kind: "user" as const, body: text, deliveryMode: "steer" as const };
    const link = execution === undefined ? undefined : rememberInvocation(task.agentName, task.id, execution, task.parentConversationId);
    try {
      const receipt = await dispatch(registered.agent, { id: task.id, message, ...(admissionKey === undefined ? {} : { idempotencyKey: admissionKey }) });
      link?.(receipt.submissionId, receipt.deduplicated === true);
      record({ name: "task.steer.admitted", phase: "end", outcome: "completed", identity: { agentInstanceId: task.id, submissionId: receipt.submissionId } });
      return receipt.submissionId;
    } finally { if (execution !== undefined) forgetProvisionalInvocation(execution.operationId); }
  }, { agentName: task.agentName, agentInstanceId: task.id }, task.parentConversationId);
}

