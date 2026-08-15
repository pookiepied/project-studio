import { AsyncLocalStorage } from "node:async_hooks";

import { createStudioUuid, type StudioUuid } from "../identity/uuid.js";

export type ExecutionOperationKind =
  | "request"
  | "model"
  | "tool"
  | "mcp"
  | "hook"
  | "skill"
  | "subagent"
  | "compaction"
  | "provider"
  | "workflow"
  | "unknown";

export type ExecutionRootSource = "project-studio" | "flue";

export interface FlueExecutionLinks {
  readonly submissionId?: string;
  readonly conversationId?: string;
  readonly turnId?: string;
  readonly taskId?: string;
  readonly operationId?: string;
  readonly toolCallId?: string;
}

export interface ExecutionContext {
  /** Stable logical request family. Retries keep this value. */
  readonly requestId: string;
  readonly requestIdSource: ExecutionRootSource;
  /** Project Studio operation node. Flue operation ids are linked separately. */
  readonly operationId: StudioUuid;
  readonly parentOperationId?: StudioUuid;
  /** New for each attempt of the same logical operation. */
  readonly attemptId: StudioUuid;
  readonly kind: ExecutionOperationKind;
  readonly clientId?: string;
  readonly sessionId?: string;
  readonly flueSubmissionId?: string;
  readonly flueConversationId?: string;
  readonly flueTurnId?: string;
  readonly flueTaskId?: string;
  readonly flueOperationId?: string;
  readonly flueToolCallId?: string;
}

export interface RootExecutionContextOptions {
  readonly requestId?: string;
  readonly requestIdSource?: ExecutionRootSource;
  readonly kind?: ExecutionOperationKind;
  readonly clientId?: string;
  readonly sessionId?: string;
  readonly flue?: FlueExecutionLinks;
}

export interface ChildExecutionContextOptions {
  readonly kind: ExecutionOperationKind;
  readonly flue?: FlueExecutionLinks;
}

const executionStorage = new AsyncLocalStorage<ExecutionContext>();

function mappedFlueLinks(links: FlueExecutionLinks | undefined): Partial<ExecutionContext> {
  if (links === undefined) return {};
  return {
    ...(links.submissionId === undefined ? {} : { flueSubmissionId: links.submissionId }),
    ...(links.conversationId === undefined ? {} : { flueConversationId: links.conversationId }),
    ...(links.turnId === undefined ? {} : { flueTurnId: links.turnId }),
    ...(links.taskId === undefined ? {} : { flueTaskId: links.taskId }),
    ...(links.operationId === undefined ? {} : { flueOperationId: links.operationId }),
    ...(links.toolCallId === undefined ? {} : { flueToolCallId: links.toolCallId }),
  };
}

export function createRootExecutionContext(
  options: RootExecutionContextOptions = {},
): ExecutionContext {
  const source = options.requestIdSource ?? "project-studio";
  const requestId =
    source === "flue"
      ? options.requestId ?? options.flue?.submissionId ?? options.flue?.conversationId ?? createStudioUuid()
      : options.requestId ?? createStudioUuid();

  return {
    requestId,
    requestIdSource: source,
    operationId: createStudioUuid(),
    attemptId: createStudioUuid(),
    kind: options.kind ?? "request",
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...mappedFlueLinks(options.flue),
  };
}

export function createChildExecutionContext(
  parent: ExecutionContext,
  options: ChildExecutionContextOptions,
): ExecutionContext {
  return {
    ...parent,
    ...mappedFlueLinks(options.flue),
    operationId: createStudioUuid(),
    parentOperationId: parent.operationId,
    attemptId: createStudioUuid(),
    kind: options.kind,
  };
}

/**
 * A new attempt at the same operation: same `requestId`, same `operationId`,
 * fresh `attemptId`.
 *
 * **Declared, not wired.** ADR 0033 specifies `attemptId` as "new for each
 * execution/retry attempt", and nothing in the Harness retries yet — Flue owns
 * recovery, and automatic retry is off pending decision #12. So this has a test
 * and no production caller, deliberately, and is not dead code to be deleted on
 * the next sweep. The caller arrives with retry.
 */
export function createRetryExecutionContext(
  operation: ExecutionContext,
): ExecutionContext {
  return {
    ...operation,
    attemptId: createStudioUuid(),
  };
}

export function currentExecutionContext(): ExecutionContext | undefined {
  return executionStorage.getStore();
}

export function runWithExecutionContext<T>(
  context: ExecutionContext,
  callback: () => T,
): T {
  return executionStorage.run(context, callback);
}
