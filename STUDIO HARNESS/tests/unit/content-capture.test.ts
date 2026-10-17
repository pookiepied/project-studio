import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnosticProjectedContent, serializeDiagnosticValue } from "../../src/observability/diagnostic-value.js";
import { RUNTIME_CONTENT_FIELDS, schemaContentFields } from "../../src/observability/content-fields.js";
import { recordFlueObservation } from "../../src/observability/runtime-observations.js";
import { bindObservationContext, diagnosticRecorder, type ObservationInput } from "../../src/observability/recorder.js";
import { flueObservationContent, installObservationSource, type ObservationSourceBridge } from "../../src/observability/observation-source.js";
import { createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";

const undeclaredSource: ObservationInput = { name: "type.fixture", phase: "progress",
  // @ts-expect-error Arbitrary objects require a bounded source-frame or projection factory.
  content: { userData: "undeclared" } };
void undeclaredSource;

afterEach(() => {
  vi.restoreAllMocks();
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("source-owned content projection", () => {
  it.each(["clear", "enable"] as const)("withholds old runtime aggregate content after capture %s", (change) => {
    diagnosticRecorder.configure({ enabled: change !== "enable", captureContent: true, conversations: ["selected"] });
    const old = bindObservationContext(createRootExecutionContext({ flue: { instanceId: "selected" } }));
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true });
    runWithExecutionContext(old, () => recordFlueObservation({ v: 3, eventIndex: 7, timestamp: "2026-10-16T00:00:00.000Z",
      type: "submission_settled", instanceId: "selected", submissionId: "sub_old", outcome: "failed", error: { message: "private old failure" } }));
    const event = diagnosticRecorder.read().events[0];
    expect(event?.outcome).toBe("failed");
    expect(event?.content).toBeUndefined();
    expect(event?.contentState).toBe("unavailable");
    expect(event?.contentOmission).toBe("capture_epoch_changed");
    expect(JSON.stringify(event)).not.toContain("private old failure");
  });

  it("does not relabel a parent's late settlement when a child starts in a newer capture", () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const common = { v: 3, timestamp: "2026-10-16T00:00:00.000Z", instanceId: "selected", submissionId: "sub_parent" } as const;
    recordFlueObservation({ ...common, eventIndex: 1, type: "submission_running", kind: "direct", attemptCount: 1, maxAttempts: 2 });
    diagnosticRecorder.clear();
    const newer = bindObservationContext(createRootExecutionContext({ flue: { instanceId: "selected" } }));
    runWithExecutionContext(newer, () => {
      recordFlueObservation({ ...common, eventIndex: 2, type: "agent_start" });
      recordFlueObservation({ ...common, eventIndex: 3, type: "submission_settled", outcome: "failed", error: { message: "old parent failure" } });
    });
    expect(diagnosticRecorder.read().events.at(-1)?.contentOmission).toBe("capture_epoch_changed");
  });

  it("classifies an explicitly aborted model turn as cancelled and leaves agent-end completion unknown", () => {
    diagnosticRecorder.configure({ enabled: true });
    const common = { v: 3, timestamp: "2026-10-16T00:00:00.000Z", instanceId: "selected" } as const;
    recordFlueObservation({ ...common, eventIndex: 1, type: "turn", turnId: "turn", purpose: "agent", durationMs: 1,
      request: { providerId: "test", providerName: "test", requestedModel: "test", api: "test" },
      response: { finishReason: "aborted" }, isError: true });
    expect(diagnosticRecorder.read().events.at(-1)?.outcome).toBe("cancelled");
    recordFlueObservation({ ...common, eventIndex: 2, type: "agent_end", messages: [] });
    expect(diagnosticRecorder.read().events.at(-1)?.outcome).toBe("unknown");
  });
  it("preserves original indexed fields without enumerating snapshots and labels an exhausted source index", () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const stop = installObservationSource();
    const sourceGlobal: typeof globalThis & { __projectStudioObservationSource?: ObservationSourceBridge | undefined } = globalThis;
    try {
      expect(sourceGlobal.__projectStudioObservationSource?.capture({ instanceId: "other" })).toBeUndefined();
      const source = sourceGlobal.__projectStudioObservationSource?.capture({ instanceId: "selected" });
      expect(source?.remaining).toBe(128);
      const snapshot = Object.freeze({ vendorSpecificField: "original value", authToken: "opaque", child: { data: "not indexed" } });
      source?.register(snapshot, Reflect.ownKeys(snapshot));
      const original = Object.keys;
      vi.spyOn(Object, "keys").mockImplementation((value) => {
        if (value === snapshot || value === snapshot.child) throw new Error("snapshot must use its source index");
        return original(value);
      });
      expect(serializeDiagnosticValue(flueObservationContent(snapshot))).toEqual({ truncated: true,
        value: { vendorSpecificField: "original value", authToken: "[REDACTED]", child: "[object omitted: source indexing budget]" } });
    } finally { stop(); }
  });
  it("reads declared fields without enumerating unrelated data and labels the projection", () => {
    const input = { text: "visible", extraVendorField: "not declared" };
    const original = Object.keys;
    const keys = vi.spyOn(Object, "keys").mockImplementation((object) => {
      if (object === input) throw new Error("arbitrary source enumeration");
      return original(object);
    });
    expect(serializeDiagnosticValue(diagnosticProjectedContent(input, ["text"]))).toEqual({
      value: { text: "visible" }, projected: true, truncated: false,
    });
    expect(keys).not.toHaveBeenCalledWith(input);
  });

  it("bounds nested shapes, never invokes accessors or proxy traps, and redacts declared secret fields", () => {
    let reads = 0;
    const input = { authToken: "opaque", child: { text: "hello" }, get text() { reads++; return "unsafe"; } };
    const projected = serializeDiagnosticValue(diagnosticProjectedContent(input, ["authToken", "child", "text"]));
    expect(projected.value).toMatchObject({ authToken: "[REDACTED]", child: { text: "hello" }, text: "[omitted]" });
    expect(projected.truncated).toBe(true);
    const proxy = new Proxy({}, { ownKeys() { reads++; throw new Error("must not enumerate"); } });
    expect(serializeDiagnosticValue(diagnosticProjectedContent(proxy, ["text"])).value).toBe("[proxy omitted]");
    expect(reads).toBe(0);
    expect(serializeDiagnosticValue(diagnosticProjectedContent({ text: "hello" }, Array.from({ length: 256 }, (_, at) => `missing_${at}`)), 100).truncated).toBe(true);
    expect(serializeDiagnosticValue(1n << 100_000n)).toEqual({ value: "[bigint omitted: scalar budget]", truncated: true });
    expect(serializeDiagnosticValue(42n).value).toBe("42");
  });

  it("takes new tool argument fields from their existing JSON schema, including nested arrays and alternatives", () => {
    const fields = schemaContentFields({ type: "object", properties: { newFeatureField: { type: "string" },
      nested: { type: "array", items: { anyOf: [{ type: "object", properties: { value: { type: "string" } } }] } },
      authToken: { type: "string" } } });
    expect(fields).toEqual(["newFeatureField", "nested", "value", "authToken"]);
    expect(serializeDiagnosticValue(diagnosticProjectedContent({ newFeatureField: "actual input", nested: [{ value: "kept" }], authToken: "opaque" }, fields)).value)
      .toEqual({ newFeatureField: "actual input", nested: [{ value: "kept" }], authToken: "[REDACTED]" });
  });

  it("captures runtime text, reasoning, errors and structured usage without flattening provider objects", () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    recordFlueObservation({ v: 3, eventIndex: 1, timestamp: "2026-10-16T00:00:00.000Z", instanceId: "selected",
      type: "thinking_delta", delta: "exposed reasoning", contentIndex: 0 });
    const event = diagnosticRecorder.read().events[0];
    expect(event?.contentState).toBe("projected");
    expect(event?.content).toMatchObject({ type: "thinking_delta", delta: "exposed reasoning" });
    expect(RUNTIME_CONTENT_FIELDS).toContain("errorInfo");
    recordFlueObservation({ v: 3, eventIndex: 2, timestamp: "2026-10-16T00:00:00.000Z", instanceId: "other",
      type: "text_delta", text: "private other conversation" });
    expect(diagnosticRecorder.read().events[1]?.content).toBeUndefined();
  });
});
