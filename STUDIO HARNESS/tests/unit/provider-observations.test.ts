import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { observeProviderStream } from "../../src/gateway/language/provider-observations.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";
import { createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";

const model: Model<Api> = {
  id: "test", name: "Test", api: "openai-completions", provider: "test", baseUrl: "http://127.0.0.1",
  reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000,
};
const message: AssistantMessage = {
  role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], timestamp: Date.now(), stopReason: "stop",
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
afterEach(() => diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] }));

describe("provider observation callback composition", () => {
  it("omits opaque argument fragments across Responses, Completions, Anthropic and Pi without changing callbacks", async () => {
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["cnv"] });
    let hooked: SimpleStreamOptions = {};
    const original = vi.fn();
    const stream = createAssistantMessageEventStream();
    runWithExecutionContext(createRootExecutionContext({ flue: { instanceId: "cnv" } }), () =>
      observeProviderStream(model, { onProviderStreamEvent: original }, (options) => { hooked = options; return stream; }));
    const items = [
      { type: "response.function_call_arguments.delta", delta: "opaque-responses" },
      { type: "response.function_call_arguments.delta", delta: '"opaque-json-scalar"' },
      { type: "response.custom_tool_call_input.delta", delta: "opaque-custom" },
      { type: "toolcall_delta", delta: "opaque-pi" },
      { choices: [{ delta: { tool_calls: [{ function: { arguments: '"opaque-completion"' } }] } }] },
      { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '"opaque-anthropic"' } },
    ];
    for (const item of items) await hooked.onProviderStreamEvent?.(item, model);
    const captured = diagnosticRecorder.read().events.filter((event) => event.name === "provider.item");
    expect(captured).toHaveLength(items.length);
    expect(captured.every((event) => event.contentState === "truncated" && JSON.stringify(event.content).includes("argument fragment"))).toBe(true);
    expect(JSON.stringify(captured)).not.toContain("opaque-");
    expect(original.mock.calls.map((call) => call[0])).toEqual(items);
    await hooked.onProviderStreamEvent?.({ type: "response.output_text.delta", delta: "ordinary text" }, model);
    expect(diagnosticRecorder.read().events.at(-1)?.content).toMatchObject({ delta: "ordinary text" });
    stream.end(message);
    await stream.result();
  });
  it("keeps disabled observation on the exact original options path", () => {
    diagnosticRecorder.configure({ enabled: false });
    const options = { onPayload: vi.fn() };
    const stream = createAssistantMessageEventStream();
    expect(observeProviderStream(model, options, (received) => {
      expect(received).toBe(options); return stream;
    })).toBe(stream);
    expect(options.onPayload).not.toHaveBeenCalled();
    stream.end(message);
  });

  it("reports null hook results without claiming which payload the SDK subsequently sends", async () => {
    diagnosticRecorder.clear();
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["cnv"] });
    let hooked: SimpleStreamOptions = {};
    const stream = createAssistantMessageEventStream();
    runWithExecutionContext(createRootExecutionContext({ flue: { instanceId: "cnv" } }),
      () => observeProviderStream(model, { onPayload: () => null }, (options) => { hooked = options; return stream; }));
    expect(await hooked.onPayload?.({ model: "before" }, model)).toBeNull();
    expect(diagnosticRecorder.read().events.find((event) => event.name === "provider.payload"))
      .toMatchObject({ content: null, attributes: { stage: "before_sdk_payload_selection", hookResult: "null" } });
    stream.end(message);
    await stream.result();
  });
  it("preserves stream identity, callback transformation and the final result", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["cnv"] });
    const root = createRootExecutionContext({ flue: { instanceId: "cnv" } });
    const onResponse = vi.fn(); const onItem = vi.fn();
    const transformed = { model: "body" };
    let hooked: SimpleStreamOptions = {};
    const stream = createAssistantMessageEventStream();
    const returned = runWithExecutionContext(root, () => observeProviderStream(model, {
      onPayload: () => transformed, onResponse, onProviderStreamEvent: onItem,
    }, (options) => { hooked = options; return stream; }));
    expect(returned).toBe(stream);
    expect(await hooked.onPayload?.({ original: true }, model)).toBe(transformed);
    await hooked.onResponse?.({ status: 200, headers: { "set-cookie": "never-capture", "x-request-id": "provider-123" } }, model);
    await hooked.onProviderStreamEvent?.({ delta: "hello" }, model);
    stream.end(message);
    expect(await stream.result()).toBe(message);
    await Promise.resolve();
    expect(onResponse).toHaveBeenCalledOnce(); expect(onItem).toHaveBeenCalledOnce();
    const events = diagnosticRecorder.read().events;
    expect(events.find((event) => event.name === "provider.payload")?.content).toEqual(transformed);
    expect(events.at(-1)?.outcome).toBe("completed");
    expect(events[0]?.identity.parentOperationId).toBe(root.operationId);
    expect(new Set(events.map((event) => event.identity.operationId)).size).toBe(1);
    expect(JSON.stringify(events)).not.toContain("never-capture");
    expect(JSON.stringify(events)).toContain("provider-123");
  });

  it("preserves original hook failures and does not fail on malformed diagnostic headers", async () => {
    diagnosticRecorder.configure({ enabled: true });
    const failure = new Error("original hook failure");
    let hooked: SimpleStreamOptions = {};
    const stream = createAssistantMessageEventStream();
    observeProviderStream(model, { onProviderStreamEvent: () => { throw failure; } }, (options) => { hooked = options; return stream; });
    await expect(hooked.onProviderStreamEvent?.({}, model)).rejects.toBe(failure);
    await expect(hooked.onResponse?.({ status: 200, headers: new Proxy({}, { ownKeys() { throw new Error("bad headers"); } }) }, model)).resolves.toBeUndefined();
    stream.end({ ...message, stopReason: "error", errorMessage: "failed" });
    await stream.result(); await Promise.resolve();
    expect(diagnosticRecorder.read().events.at(-1)?.outcome).toBe("failed");
  });
});
