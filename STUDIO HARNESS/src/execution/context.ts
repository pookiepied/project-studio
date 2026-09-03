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

/**
 * The Flue identities one operation is linked to.
 *
 * ---- What 2.0 split, and which half is which ------------------------------
 *
 * 1.0 had one run identity. 2.0 split it in two, and both halves are here
 * because they answer different questions:
 *
 * - **`instanceId`** is the agent INSTANCE - the thread the work belongs to,
 *   chosen by the caller. In this product it is the conversation id the
 *   webview minted (`cnv_<uuid>`), or `<conversation id>-t<N>` for a titling
 *   retry. It is stable across every submission that thread ever runs.
 * - **`submissionId`** is ONE admitted piece of durable work on that
 *   instance (`sub_<ulid>`), direct or dispatched. 2.0's `dispatchId` is
 *   this, under the one name both kinds now share.
 *
 * `conversationId` is Flue's own (`conv_<ulid>`): the durable stream behind
 * an instance, minted by the runtime. It is NOT the product's conversation
 * id and never was - a log line correlating on it cannot be joined to
 * anything a person can see. `instanceId` is the field that can, which is
 * why it is linked rather than left on the floor: until Phase 7 it was not,
 * and every Flue-rooted log line named a conversation nobody could look up.
 *
 * `agentName` says which agent ran, which is what tells a conversation's own
 * turn apart from the background titling run that follows it - two runs on
 * the same instance id, seconds apart, on different models.
 */
export interface FlueExecutionLinks {
  readonly instanceId?: string;
  readonly agentName?: string;
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
  /** The agent instance: this product's conversation id. */
  readonly flueInstanceId?: string;
  readonly flueAgentName?: string;
  readonly flueSubmissionId?: string;
  /** Flue's own `conv_<ulid>` stream id, not the product's conversation. */
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
    ...(links.instanceId === undefined ? {} : { flueInstanceId: links.instanceId }),
    ...(links.agentName === undefined ? {} : { flueAgentName: links.agentName }),
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
      ? options.requestId ??
        options.flue?.submissionId ??
        // The instance before Flue's own stream id: both are only reached
        // when no submission scopes the work (a coordinator pass), and of
        // the two only the instance names something a person can look up.
        options.flue?.instanceId ??
        options.flue?.conversationId ??
        createStudioUuid()
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
