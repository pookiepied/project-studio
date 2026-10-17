import type { ExecutionContext } from "../execution/context.js";

interface Invocation {
  readonly agentName: string;
  readonly instanceId: string;
  readonly execution: ExecutionContext;
  readonly conversationId: string | undefined;
  submissionId?: string;
}

// Correlation survives detached runtime scheduling without changing tool scope.
// Keep only a bounded process window; a missing link is missing evidence.
const invocations = new Map<string, Invocation>();
const instances = new Map<string, Invocation>();
const submissions = new Map<string, Invocation>();
const pending = new Map<string, Set<Invocation>>();
const MAX_INVOCATIONS = 10_000;
const keyFor = (agentName: string, instanceId: string) => JSON.stringify([agentName, instanceId]);
const pendingKey = (invocation: Invocation) => JSON.stringify([invocation.execution.requestId, invocation.agentName, invocation.instanceId]);

function removePending(invocation: Invocation): void {
  const key = pendingKey(invocation);
  const waiting = pending.get(key);
  waiting?.delete(invocation);
  if (waiting?.size === 0) pending.delete(key);
}

function linkInvocation(invocation: Invocation, submissionId: string, deduplicated: boolean): void {
  if (invocations.get(invocation.execution.operationId) !== invocation) return;
  if (invocation.submissionId !== undefined && invocation.submissionId !== submissionId) return;
  invocation.submissionId = submissionId;
  removePending(invocation);
  const key = keyFor(invocation.agentName, invocation.instanceId);
  const original = submissions.get(submissionId);
  if (original !== undefined || deduplicated) {
    if (instances.get(key) === invocation) {
      if (original?.agentName === invocation.agentName && original.instanceId === invocation.instanceId) instances.set(key, original);
      else instances.delete(key);
    }
    return;
  }
  submissions.set(submissionId, invocation);
}

export function rememberInvocation(agentName: string, instanceId: string, execution: ExecutionContext, conversationId?: string): (submissionId: string, deduplicated?: boolean) => void {
  const key = keyFor(agentName, instanceId);
  const invocation: Invocation = { agentName, instanceId, execution, conversationId };
  invocations.set(execution.operationId, invocation);
  instances.set(key, invocation);
  const waitingKey = pendingKey(invocation);
  const waiting = pending.get(waitingKey) ?? new Set<Invocation>();
  waiting.add(invocation);
  pending.set(waitingKey, waiting);
  if (invocations.size > MAX_INVOCATIONS) {
    const oldest = invocations.entries().next().value;
    if (oldest !== undefined) {
      invocations.delete(oldest[0]);
      removePending(oldest[1]);
      const instanceKey = keyFor(oldest[1].agentName, oldest[1].instanceId);
      if (instances.get(instanceKey) === oldest[1]) instances.delete(instanceKey);
      if (oldest[1].submissionId !== undefined && submissions.get(oldest[1].submissionId) === oldest[1]) submissions.delete(oldest[1].submissionId);
    }
  }
  return (submissionId, deduplicated = false) => {
    // A repeated admission receipt is another delivery, not a new execution.
    linkInvocation(invocation, submissionId, deduplicated);
  };
}

/** Bind at the framework's actual producer boundary, before worker scheduling. */
export function observeInvocationAdmission(agentName: string, instanceId: string, submissionId: string, deduplicated: boolean, execution: ExecutionContext | undefined): void {
  if (execution === undefined || agentName.length > 128 || instanceId.length > 256 || submissionId.length > 256) return;
  const matches = (candidate: Invocation | undefined) => candidate?.agentName === agentName && candidate.instanceId === instanceId && candidate.submissionId === undefined;
  const direct = invocations.get(execution.operationId);
  const parent = execution.parentOperationId === undefined ? undefined : invocations.get(execution.parentOperationId);
  const waiting = pending.get(JSON.stringify([execution.requestId, agentName, instanceId]));
  const candidate = matches(direct) ? direct : matches(parent) ? parent : waiting?.size === 1 ? waiting.values().next().value : undefined;
  if (candidate !== undefined) linkInvocation(candidate, submissionId, deduplicated);
}

/** A refused/unknown admission must not remain a candidate for later work. */
export function forgetProvisionalInvocation(operationId: string): void {
  const invocation = invocations.get(operationId);
  if (invocation === undefined || invocation.submissionId !== undefined) return;
  invocations.delete(operationId);
  removePending(invocation);
  const key = keyFor(invocation.agentName, invocation.instanceId);
  if (instances.get(key) === invocation) instances.delete(key);
}

export function invocationFor(agentName: string | undefined, instanceId: string | undefined, submissionId?: string): Invocation | undefined {
  if (agentName === undefined || instanceId === undefined) return undefined;
  const matched = submissionId === undefined ? undefined : submissions.get(submissionId);
  if (matched !== undefined) return matched.agentName === agentName && matched.instanceId === instanceId ? matched : undefined;
  return submissionId === undefined ? instances.get(keyFor(agentName, instanceId)) : undefined;
}
