import {
  createOpenTelemetryInstrumentation,
  type OpenTelemetryInstrumentation,
} from "@flue/opentelemetry";
import { instrument, type FlueExecutionInterceptor } from "@flue/runtime";
import type {
  FlueExecutionContext,
  FlueExecutionOperation,
} from "@flue/runtime";

import {
  createChildExecutionContext,
  createRootExecutionContext,
  currentExecutionContext,
  runWithExecutionContext,
  type ExecutionContext,
  type ExecutionOperationKind,
  type FlueExecutionLinks,
} from "../execution/context.js";
import type { ObservabilityConfig } from "./config.js";
import { redactGenAiContent } from "./redaction.js";
import { TelemetryError } from "./telemetry-errors.js";

let disposeInstrumentation: (() => Promise<void>) | undefined;
let disposeTurnBoundary: (() => Promise<void>) | undefined;
let instrumentation: OpenTelemetryInstrumentation | undefined;

export function isFlueInstrumentationRegistered(): boolean {
  return disposeInstrumentation !== undefined;
}

export function registerFlueInstrumentation(config: ObservabilityConfig): void {
  if (disposeInstrumentation) {
    throw new TelemetryError("already_initialized", {
      message:
        "Flue OpenTelemetry instrumentation has already been registered.",
    });
  }

  instrumentation = createOpenTelemetryInstrumentation({
    // Flue 2.0's content option is `false` (opt out) or `{ transform }` (on
    // with a policy hook); the old `enabled` key is gone. The redaction
    // policy below is the one thing that must keep running either way.
    content: config.captureContent
      ? {
          transform(content) {
            return redactGenAiContent(content);
          },
        }
      : false,
  });

  disposeInstrumentation = instrument(instrumentation);
}

export async function unregisterFlueInstrumentation(): Promise<void> {
  const dispose = disposeInstrumentation;
  const disposeBoundary = disposeTurnBoundary;
  disposeInstrumentation = undefined;
  disposeTurnBoundary = undefined;
  instrumentation = undefined;
  await disposeBoundary?.();
  await dispose?.();
}

export function registerFlueTurnBoundary(
  beforeModel: (execution: ExecutionContext) => Promise<void>,
): void {
  if (disposeTurnBoundary !== undefined) {
    throw new TelemetryError("already_initialized", {
      message: "The Flue turn boundary has already been registered.",
    });
  }

  const interceptor: FlueExecutionInterceptor = async (operation, context, next) => {
    const execution = executionContextForFlue(operation, context);
    return runWithExecutionContext(execution, async () => {
      if (operation.type === "model") await beforeModel(execution);
      return next();
    });
  };
  disposeTurnBoundary = instrument({
    key: Symbol("project-studio-turn-boundary"),
    observe: () => undefined,
    interceptor,
    dispose: () => undefined,
  });
}

function operationKind(operation: FlueExecutionOperation): ExecutionOperationKind {
  switch (operation.type) {
    case "agent":
      if (operation.operationKind === "task") return "subagent";
      if (operation.operationKind === "skill") return "skill";
      return "request";
    case "model":
      return "model";
    case "tool":
      return "tool";
    case "task":
      return "subagent";
    case "coordinator":
      // Flue 2.0's coordinator operations are the runtime's storage
      // bookkeeping - no request, model, tool or subagent of ours. "unknown"
      // is its honest label in our vocabulary; Phase 7 decides whether it
      // earns its own kind once real traces exist to read.
      return "unknown";
  }
}

function linksForFlue(
  operation: FlueExecutionOperation,
  context: FlueExecutionContext,
): FlueExecutionLinks {
  const turnId = context.turnId ?? (operation.type === "model" ? operation.turnId : undefined);
  const taskId = context.taskId ?? (operation.type === "task" ? operation.taskId : undefined);
  const operationId =
    context.operationId ?? (operation.type === "agent" ? operation.operationId : undefined);
  return {
    // 2.0 stamps both halves of the identity 1.0 carried as one, and both
    // are linked: the instance is the product's conversation, the
    // submission is the one piece of durable work. `agentName` is what
    // separates a conversation's own turn from the titling run behind it.
    ...(context.instanceId === undefined ? {} : { instanceId: context.instanceId }),
    ...(context.agentName === undefined ? {} : { agentName: context.agentName }),
    ...(context.submissionId === undefined ? {} : { submissionId: context.submissionId }),
    ...(context.conversationId === undefined ? {} : { conversationId: context.conversationId }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(operation.type === "tool" ? { toolCallId: operation.toolCallId } : {}),
    // The Flue patch's one delegation hunk: the delegate's name on a child
    // task session's frame. The context spreads this onto every operation
    // under that session, so the gate's tools() callback — which runs inside
    // the child's assembly, under this frame — reads the acting agent from
    // the same place the interceptor does. Absent on every parent frame,
    // which is what makes its presence the signal.
    ...(context.subagentName === undefined ? {} : { subagentName: context.subagentName }),
  };
}

function executionContextForFlue(
  operation: FlueExecutionOperation,
  context: FlueExecutionContext,
): ExecutionContext {
  const kind = operationKind(operation);
  const links = linksForFlue(operation, context);
  const parent = currentExecutionContext();
  if (parent !== undefined) return createChildExecutionContext(parent, { kind, flue: links });
  // The submission first: one admitted piece of durable work is the tightest
  // thing a request id can name. Then the INSTANCE, which is this product's
  // conversation id and can be looked up by a person - ahead of Flue's own
  // `conv_<ulid>` stream id, which correlates a log line to nothing anybody
  // can see. Flue's id stays last rather than being dropped: a correlation
  // that only Flue understands still beats no correlation at all.
  const requestId =
    links.submissionId ?? links.instanceId ?? links.conversationId;

  return createRootExecutionContext({
    kind,
    ...(requestId === undefined ? {} : { requestId }),
    requestIdSource: "flue",
    flue: links,
  });
}
