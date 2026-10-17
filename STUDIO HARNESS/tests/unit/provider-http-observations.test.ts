import { afterEach, describe, expect, it, vi } from "vitest";
import { providerObservationFetch } from "../../src/gateway/language/provider-http-observations.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";

afterEach(() => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("actual provider HTTP attempts", () => {
  it("reads intrinsic response metadata without invoking a provider override", async () => {
    diagnosticRecorder.configure({ enabled: true });
    let reads = 0;
    const response = new Response("original", { status: 202 });
    Object.defineProperties(response, {
      ok: { get() { reads++; throw new Error("must not inspect override"); } },
      status: { get() { reads++; throw new Error("must not inspect override"); } },
    });
    const fetch = providerObservationFetch("openai-completions", async () => response, {});
    expect(await fetch?.("https://provider.test")).toBe(response);
    expect(reads).toBe(0);
    expect(diagnosticRecorder.read().events.at(-1)).toMatchObject({ outcome: "completed", attributes: { status: 202 } });
  });
  it("never invokes request body accessors or lets malformed response metadata replace the fetch result", async () => {
    diagnosticRecorder.configure({ enabled: true });
    let bodyReads = 0;
    let responseReads = 0;
    const response = new Proxy(new Response("body"), { get(target, key, receiver) {
      if (key === "ok" || key === "status") { responseReads++; throw new Error("diagnostic metadata getter"); }
      return Reflect.get(target, key, receiver);
    } });
    const original = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.body).toBe("original body");
      return response;
    });
    const observed = providerObservationFetch("openai-responses", original, {});
    expect(await observed?.("http://provider.test", { get body() { bodyReads++; return "original body"; } })).toBe(response);
    expect(bodyReads).toBe(1);
    expect(responseReads).toBe(0);
    expect(diagnosticRecorder.read().events.at(-1)).toMatchObject({ outcome: "unknown", attributes: { stage: "response_metadata_unavailable" } });
  });
  it("preserves fetch inputs and the exact unread response while recording serialized payloads", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const parent = { conversationId: "selected", operationId: createStudioUuid(), requestId: createStudioUuid() };
    const response = new Response("untouched body");
    const original = vi.fn<typeof fetch>().mockResolvedValue(response);
    const observed = providerObservationFetch("openai-completions", original, parent);
    expect(observed).toBeDefined();
    const init = { method: "POST", body: '{"messages":[{"content":"hello"}],"api_key":"opaque"}', headers: { authorization: "not recorded" } };
    const receiver = { transport: "sdk client" };
    expect(await observed?.call(receiver, "http://provider.test", init)).toBe(response);
    expect(original).toHaveBeenCalledExactlyOnceWith("http://provider.test", init);
    expect(original.mock.contexts[0]).toBe(receiver);
    expect(response.bodyUsed).toBe(false);
    const events = diagnosticRecorder.read().events;
    expect(events.map((event) => event.phase)).toEqual(["start", "end"]);
    expect(events[0]?.content).toEqual({ messages: [{ content: "hello" }], api_key: "[REDACTED]" });
    expect(events[0]?.identity).toMatchObject({ requestId: parent.requestId, parentOperationId: parent.operationId });
    expect(events[0]?.identity.operationId).toBe(events[1]?.identity.operationId);
    expect(JSON.stringify(events)).not.toContain("not recorded");
  });

  it("gives actual SDK retry calls distinct identities without resending anything itself", async () => {
    diagnosticRecorder.configure({ enabled: true });
    const failure = new TypeError("transport fixture failure");
    const original = vi.fn<typeof fetch>().mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const observed = providerObservationFetch("anthropic-messages", original, {});
    await expect(observed?.("http://provider.test")).rejects.toBe(failure);
    await observed?.("http://provider.test");
    expect(original).toHaveBeenCalledTimes(2);
    const starts = diagnosticRecorder.read().events.filter((event) => event.phase === "start");
    expect(starts[0]?.identity.operationId).not.toBe(starts[1]?.identity.operationId);
    expect(starts[0]?.identity.attemptId).not.toBe(starts[1]?.identity.attemptId);
  });

  it("keeps unsupported adapters and disabled capture on the original fetch path", () => {
    const original = vi.fn<typeof fetch>();
    expect(providerObservationFetch("openai-responses", original, {})).toBe(original);
    diagnosticRecorder.configure({ enabled: true });
    expect(providerObservationFetch("google-generative-ai", original, {})).toBe(original);
    expect(providerObservationFetch("google-vertex", undefined, {})).toBeUndefined();
    expect(diagnosticRecorder.read().events).toEqual([]);
  });

  it("does not clone or consume Request bodies and fences late completion after deletion", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    let resolve: ((response: Response) => void) | undefined;
    const original = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const observed = providerObservationFetch("openai-responses", original, { conversationId: "selected" });
    const input = new Request("http://provider.test", { method: "POST", body: "input" });
    const pending = observed?.(input);
    expect(input.bodyUsed).toBe(false);
    expect(diagnosticRecorder.read().events[0]?.attributes.bodyState).toBe("unavailable");
    diagnosticRecorder.clear();
    const response = new Response("answer");
    resolve?.(response);
    expect(await pending).toBe(response);
    expect(diagnosticRecorder.read().events).toEqual([]);
  });
});
