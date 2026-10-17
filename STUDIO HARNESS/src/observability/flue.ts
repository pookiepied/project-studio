import {
  createOpenTelemetryInstrumentation,
  type OpenTelemetryInstrumentation,
} from "@flue/opentelemetry";
import { instrument, observe, type FlueExecutionInterceptor } from "@flue/runtime";
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
import { recordFlueObservation } from "./runtime-observations.js";
import { bindObservationContext, createObservationWriter } from "./recorder.js";
import { observationFailure, returnedToolError } from "./operation.js";
import { performance } from "node:perf_hooks";
import { installObservationSource } from "./observation-source.js";
import { invocationFor } from "./invocations.js";

let disposeInstrumentation: (() => Promise<void>) | undefined;
let disposeTurnBoundary: (() => Promise<void>) | undefined;
let instrumentation: OpenTelemetryInstrumentation | undefined;
let stopObservations: (() => void) | undefined;
let stopSource: (() => void) | undefined;

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
  stopSource = installObservationSource();
  stopObservations = observe(recordFlueObservation);
}

export async function unregisterFlueInstrumentation(): Promise<void> {
  const dispose = disposeInstrumentation;
  const disposeBoundary = disposeTurnBoundary;
  disposeInstrumentation = undefined;
  disposeTurnBoundary = undefined;
  instrumentation = undefined;
  stopObservations?.();
  stopObservations = undefined;
  stopSource?.();
  stopSource = undefined;
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
    const recordObservation = createObservationWriter();
    const linked = invocationFor(context.agentName, context.instanceId, context.submissionId);
    const current = currentExecutionContext();
    const unobservedEntry = linked === undefined && operation.type === "agent" && operation.operationKind === "prompt" &&
      context.taskId === undefined && context.submissionId !== undefined && current?.flueSubmissionId !== context.submissionId;
    const bound = bindObservationContext(executionContextForFlue(operation, context));
    const execution = unobservedEntry ? { ...bound, observationStartUnobserved: true } : bound;
    return runWithExecutionContext(execution, async () => {
      const started = performance.now();
      const name = `execution.${operation.type}`;
      const attributes = { kind: execution.kind, stage: operation.type === "model" ? "interceptor_step"
        : operation.type === "agent" && context.submissionId !== undefined ? "submission" : "operation" };
      recordObservation({ name, phase: "start", attributes });
      try {
        if (operation.type === "model") await beforeModel(execution);
        const result = await next();
        const isError = operation.type === "tool" ? returnedToolError(result) : false;
        recordObservation({ name, phase: "end", outcome: isError === undefined ? "unknown" : isError ? "failed" : "completed",
          attributes: { ...attributes, durationMs: performance.now() - started,
            ...(isError === true ? { returnedError: true } : isError === undefined ? { resultErrorUnavailable: true } : {}) } });
        return result;
      } catch (error) {
        const failure = observationFailure(error);
        recordObservation({ name, phase: "end", outcome: failure.cancelled ? "cancelled" : "failed",
          attributes: { ...attributes, durationMs: performance.now() - started, errorCode: failure.errorCode } });
        throw error;
      }
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
  const invocation = invocationFor(context.agentName, context.instanceId, context.submissionId);
  const current = currentExecutionContext();
  const detachedEntry = operation.type === "agent" && operation.operationKind === "prompt" && context.taskId === undefined && context.submissionId !== undefined;
  const descendant = current?.flueSubmissionId === context.submissionId && current?.flueAgentName === context.agentName && current?.flueInstanceId === context.instanceId;
  const parent = detachedEntry && !descendant
    ? invocation?.execution
    : current ?? invocation?.execution;
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
