import { performance } from "node:perf_hooks";
import { isStudioError } from "../contracts/errors.js";
import {
  createChildExecutionContext, createRootExecutionContext, currentExecutionContext,
  runWithExecutionContext, type ExecutionOperationKind,
} from "../execution/context.js";
import { bindObservationContext, createObservationWriter, diagnosticRecorder, executionIdentity, recordObservation } from "./recorder.js";
import type { ObservationIdentity, ObservationOutcome } from "../contracts/diagnostics.js";
import { diagnosticProjectedContent } from "./diagnostic-value.js";
import { ERROR_CONTENT_FIELDS } from "./content-fields.js";
import { types } from "node:util";

/** MCP-style returned errors are different from a thrown invocation failure. */
export function returnedToolError(value: unknown): boolean | undefined {
  if (value === null || typeof value !== "object") return false;
  if (types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "isError");
    if (descriptor === undefined) return false;
    return "value" in descriptor && typeof descriptor.value === "boolean" ? descriptor.value : undefined;
  } catch { return undefined; }
}

/** Evidence lifetime for jobs that return before their work finishes. */
export class OperationObservation {
  readonly execution;
  readonly #identity: ObservationIdentity;
  readonly #name: string;
  readonly #attributes: Readonly<Record<string, unknown>>;
  readonly #captureId: string | undefined;
  readonly #started = performance.now();
  #finished = false;

  constructor(kind: ExecutionOperationKind, name: string, identity: ObservationIdentity = {}, attributes: Readonly<Record<string, unknown>> = {}) {
    const parent = currentExecutionContext();
    const scope = identity.conversationId === undefined ? {} : { flue: { instanceId: identity.conversationId } };
    this.execution = bindObservationContext(parent ? createChildExecutionContext(parent, { kind, ...scope }) : createRootExecutionContext({ kind, ...scope }));
    this.#identity = runWithExecutionContext(this.execution, () => ({ ...executionIdentity(), ...identity }));
    this.#name = name;
    this.#attributes = attributes;
    this.#captureId = diagnosticRecorder.enabled ? diagnosticRecorder.captureId : undefined;
    this.#record("start", {});
  }

  progress(attributes: Readonly<Record<string, unknown>>): void {
    if (!this.#finished) this.#record("progress", attributes);
  }

  finish(outcome: ObservationOutcome, attributes: Readonly<Record<string, unknown>> = {}): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#record("end", { ...attributes, durationMs: performance.now() - this.#started }, outcome);
  }

  #record(phase: "start" | "progress" | "end", attributes: Readonly<Record<string, unknown>>, outcome?: ObservationOutcome): void {
    if (this.#captureId === undefined || this.#captureId !== diagnosticRecorder.captureId) return;
    recordObservation({ name: this.#name, phase, identity: this.#identity, attributes: { ...this.#attributes, ...attributes },
      ...(outcome === undefined ? {} : { outcome }) });
  }
}

/** Preserve the original exception; classify only known cancellation signals. */
export function observationFailure(error: unknown): { errorCode: string; cancelled: boolean } {
  try {
    if (types.isProxy(error)) return { errorCode: "unclassified", cancelled: false };
    if (isStudioError(error)) return { errorCode: error.code, cancelled: error.kind === "cancelled" };
    if (error instanceof DOMException) {
      const name: unknown = Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get?.call(error);
      return { errorCode: name === "AbortError" ? "AbortError" : "Error", cancelled: name === "AbortError" };
    }
    if (types.isNativeError(error)) {
      let value: object | null = error;
      for (let depth = 0; depth < 5 && value !== null; depth++) {
        if (types.isProxy(value)) break;
        const name = Object.getOwnPropertyDescriptor(value, "name");
        if (name !== undefined) {
          const candidate: unknown = "value" in name ? name.value : undefined;
          const errorCode = typeof candidate === "string" &&
            ["Error", "AbortError", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError"].includes(candidate)
            ? candidate : "unclassified";
          return { errorCode, cancelled: errorCode === "AbortError" };
        }
        value = Object.getPrototypeOf(value) as object | null;
      }
    }
  } catch { /* A hostile thrown value cannot break recording or replace the error. */ }
  return { errorCode: "unclassified", cancelled: false };
}

/** Standard feature boundary: one identity, one attempt, start and terminal evidence. */
export function observeOperation<T>(
  kind: ExecutionOperationKind,
  name: string,
  action: () => Promise<T>,
  attributes: Readonly<Record<string, unknown>> = {},
  conversationId?: string,
): Promise<T> {
  const parent = currentExecutionContext();
  const scope = conversationId === undefined ? {} : { flue: { instanceId: conversationId } };
  const execution = bindObservationContext(parent ? createChildExecutionContext(parent, { kind, ...scope }) : createRootExecutionContext({ kind, ...scope }));
  return runWithExecutionContext(execution, async () => {
    const record = createObservationWriter();
    const started = performance.now();
    record({ name, phase: "start", attributes });
    try {
      const value = await action();
      const isError = kind === "tool" ? returnedToolError(value) : false;
      record({ name, phase: "end", outcome: isError === undefined ? "unknown" : isError ? "failed" : "completed",
        attributes: { ...attributes, durationMs: performance.now() - started,
          ...(isError === true ? { returnedError: true } : isError === undefined ? { resultErrorUnavailable: true } : {}) } });
      return value;
    } catch (error) {
      const failure = observationFailure(error);
      record({ name, phase: "end", outcome: failure.cancelled ? "cancelled" : "failed",
        attributes: { ...attributes, durationMs: performance.now() - started, errorCode: failure.errorCode },
        content: diagnosticProjectedContent(error, ERROR_CONTENT_FIELDS) });
      throw error;
    }
  });
}

/** Preserve synchronous ordering for validation/containment before admission. */
export function observeSynchronousOperation<T>(
  kind: ExecutionOperationKind, name: string, action: () => T,
): T {
  const parent = currentExecutionContext();
  const execution = bindObservationContext(parent ? createChildExecutionContext(parent, { kind }) : createRootExecutionContext({ kind }));
  return runWithExecutionContext(execution, () => {
    const record = createObservationWriter();
    const started = performance.now();
    record({ name, phase: "start" });
    try {
      const result = action();
      record({ name, phase: "end", outcome: "completed", attributes: { durationMs: performance.now() - started } });
      return result;
    } catch (error) {
      const failure = observationFailure(error);
      record({ name, phase: "end", outcome: failure.cancelled ? "cancelled" : "failed",
        attributes: { durationMs: performance.now() - started, errorCode: failure.errorCode }, content: diagnosticProjectedContent(error, ERROR_CONTENT_FIELDS) });
      throw error;
    }
  });
}
