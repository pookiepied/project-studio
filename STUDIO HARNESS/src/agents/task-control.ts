import { dispatch } from "@flue/runtime";
import { agentRegistry } from "./definitions/index.js";
import type { AgentTaskRecord } from "./definitions/task-store.js";
import { isSettledTaskStatus } from "../contracts/agents.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import { observeOperation } from "../observability/operation.js";
import { currentExecutionContext } from "../execution/context.js";
import { forgetProvisionalInvocation, rememberInvocation } from "../observability/invocations.js";
import { createObservationWriter } from "../observability/recorder.js";

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

