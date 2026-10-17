import type { Api, AssistantMessageEventStream, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { performance } from "node:perf_hooks";
import { createStudioUuid } from "../../contracts/uuid.js";
import { createObservationWriter, diagnosticRecorder, executionIdentity } from "../../observability/recorder.js";
import { observationFailure } from "../../observability/operation.js";
import { providerObservationFetch } from "./provider-http-observations.js";
import { diagnosticProjectedContent } from "../../observability/diagnostic-value.js";
import { PROVIDER_CONTENT_FIELDS } from "../../observability/content-fields.js";

/** Observe the actual target, preserving the original stream and callback semantics. */
export function observeProviderStream(
  target: Model<Api>,
  options: SimpleStreamOptions | undefined,
  start: (options: SimpleStreamOptions) => AssistantMessageEventStream,
): AssistantMessageEventStream {
  if (!diagnosticRecorder.enabled) return start(options ?? {});
  const recordObservation = createObservationWriter();
  const parent = executionIdentity();
  const identity = { ...parent, operationId: createStudioUuid(), attemptId: createStudioUuid(),
    ...(parent.operationId === undefined ? {} : { parentOperationId: parent.operationId }) };
  const attributes = { provider: target.provider, model: target.id, api: target.api };
  const started = performance.now();
  let itemIndex = 0;
  recordObservation({ name: "provider.stream", phase: "start", identity, attributes });
  try {
    const fetch = providerObservationFetch(target.api, options?.fetch, identity);
    const stream = start({
      ...options,
      ...(fetch === undefined ? {} : { fetch }),
      async onPayload(payload, model) {
        const transformed = await options?.onPayload?.(payload, model);
        recordObservation({ name: "provider.payload", phase: "progress", identity,
          attributes: { ...attributes, stage: "before_sdk_payload_selection",
            hookResult: transformed === undefined ? "undefined" : transformed === null ? "null" : "replacement" },
          content: diagnosticProjectedContent(transformed === undefined ? payload : transformed, PROVIDER_CONTENT_FIELDS) });
        return transformed;
      },
      async onResponse(response, model) {
        // No cookies, authorization or arbitrary headers enter observations.
        try {
          const headers: Record<string, string> = {};
          for (const key of ["x-request-id", "request-id", "retry-after"]) {
            const descriptor = Object.getOwnPropertyDescriptor(response.headers, key);
            if (descriptor && "value" in descriptor && typeof descriptor.value === "string") headers[key] = descriptor.value;
          }
          recordObservation({ name: "provider.response", phase: "progress", identity,
            attributes: { ...attributes, status: response.status, elapsedMs: performance.now() - started, ...headers } });
        } catch { /* Malformed diagnostic headers cannot interrupt provider consumption. */ }
        await options?.onResponse?.(response, model);
      },
      async onProviderStreamEvent(data, model) {
        recordObservation({ name: "provider.item", phase: "progress", identity,
          attributes: { ...attributes, itemIndex: itemIndex++, elapsedMs: performance.now() - started },
          content: diagnosticProjectedContent(data, PROVIDER_CONTENT_FIELDS) });
        await options?.onProviderStreamEvent?.(data, model);
      },
    });
    // This is an independent observer of the shared result promise, not a consumer
    // of the async iterator. Failed diagnostics must never replace the stream.
    try { void stream.result().then((message) => {
      const outcome = message.stopReason === "aborted" ? "cancelled" : message.stopReason === "error" ? "failed" : "completed";
      recordObservation({ name: "provider.stream", phase: "end", identity, outcome,
        attributes: { ...attributes, durationMs: performance.now() - started, itemCount: itemIndex, finishReason: message.stopReason },
        content: message.errorMessage });
    }, (error: unknown) => {
      const failure = observationFailure(error);
      recordObservation({ name: "provider.stream", phase: "end", identity, outcome: failure.cancelled ? "cancelled" : "failed",
        attributes: { ...attributes, durationMs: performance.now() - started, errorCode: failure.errorCode } });
    }).catch(() => undefined); } catch { /* Keep the original stream usable. */ }
    return stream;
  } catch (error) {
    const failure = observationFailure(error);
    recordObservation({ name: "provider.stream", phase: "end", identity, outcome: failure.cancelled ? "cancelled" : "failed",
      attributes: { ...attributes, durationMs: performance.now() - started, errorCode: failure.errorCode } });
    throw error;
  }
}
