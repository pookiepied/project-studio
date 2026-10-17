import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ObservationIdentity } from "../../contracts/diagnostics.js";
import { createStudioUuid } from "../../contracts/uuid.js";
import { createObservationWriter, diagnosticRecorder } from "../../observability/recorder.js";
import { diagnosticJsonContent } from "../../observability/diagnostic-value.js";
import { observationFailure } from "../../observability/operation.js";
import { performance } from "node:perf_hooks";
import { types } from "node:util";

// These installed Pi adapters explicitly accept a fetch implementation. Others
// (notably Google) reject injection, so observation must not change their path.
const FETCH_APIS = new Set([
  "anthropic-messages", "openai-completions", "openai-responses", "azure-openai-responses",
  "openai-codex-responses", "pi-messages", "mistral-conversations",
]);

/** Observe actual SDK HTTP attempts without consuming request/response streams. */
export function providerObservationFetch(
  api: string, original: SimpleStreamOptions["fetch"], parent: ObservationIdentity,
): SimpleStreamOptions["fetch"] {
  if (!FETCH_APIS.has(api) || !diagnosticRecorder.enabled) return original;
  const record = createObservationWriter();
  const fetch = original ?? globalThis.fetch;
  return async function (this: unknown, input, init) {
    const identity = { ...parent, operationId: createStudioUuid(), attemptId: createStudioUuid(),
      ...(parent.operationId === undefined ? {} : { parentOperationId: parent.operationId }) };
    const began = performance.now();
    // The SDK already serialized this string for sending. A Request body or
    // multipart/stream input is not read or cloned just for capture.
    const bodyDescriptor = init !== undefined && init !== null && typeof init === "object" && !types.isProxy(init)
      ? Object.getOwnPropertyDescriptor(init, "body") : undefined;
    const body = bodyDescriptor && "value" in bodyDescriptor && typeof bodyDescriptor.value === "string" ? bodyDescriptor.value : undefined;
    const capture = body !== undefined && diagnosticRecorder.capturesContent(identity.conversationId);
    record({ name: "provider.http", phase: "start", identity,
      attributes: { api, bodyState: body === undefined ? "unavailable" : "serialized" },
      ...(capture ? { content: diagnosticJsonContent(body) } : {}) });
    try {
      const response = await fetch.call(this, input, init);
      try {
        if (types.isProxy(response)) {
          record({ name: "provider.http", phase: "end", identity, outcome: "unknown",
            attributes: { api, stage: "response_metadata_unavailable", durationMs: performance.now() - began } });
        } else {
          // Use the platform metadata getters, never a provider's overridden accessor.
          const ok: unknown = Object.getOwnPropertyDescriptor(Response.prototype, "ok")?.get?.call(response);
          const status: unknown = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get?.call(response);
          record({ name: "provider.http", phase: "end", identity, outcome: typeof ok !== "boolean" ? "unknown" : ok ? "completed" : "failed",
            attributes: { api, ...(typeof status === "number" ? { status } : {}), durationMs: performance.now() - began } });
        }
      } catch {
        record({ name: "provider.http", phase: "end", identity, outcome: "unknown",
          attributes: { api, stage: "response_metadata_unavailable", durationMs: performance.now() - began } });
      }
      return response;
    } catch (error) {
      const failure = observationFailure(error);
      record({ name: "provider.http", phase: "end", identity, outcome: failure.cancelled ? "cancelled" : "failed",
        attributes: { api, errorCode: failure.errorCode, durationMs: performance.now() - began } });
      throw error;
    }
  };
}
