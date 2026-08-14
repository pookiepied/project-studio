
import { describe, it, expect } from "vitest";
import { toOpenAIChatCompletion, toOpenAIEmbeddings, toOpenAIImages, mapFinishReason } from "../src/providers/shared/normalization.ts";
import { openAIChunk, openAIDone } from "../src/providers/shared/runtime.ts";

describe("normalization", () => {
  it("toOpenAIChatCompletion", () => {
    const out = toOpenAIChatCompletion("id1", "model1", "hello", { finishReason: "stop" });
    expect((out as any).choices[0].message.content).toBe("hello");
  });
  it("toOpenAIEmbeddings", () => {
    const out = toOpenAIEmbeddings("model1", [[1,2,3]], { tokens: 10 });
    expect((out as any).data.length).toBe(1);
  });
  it("toOpenAIImages", () => {
    expect((toOpenAIImages([{ b64_json: "abc" }]) as any).data.length).toBe(1);
  });
  it("openAIChunk shape", () => {
    const s = openAIChunk("chatcmpl_123", "model1", { content: "hi" });
    expect(s.startsWith("data: ")).toBe(true);
    const inner = JSON.parse(s.slice(6));
    expect(inner.choices[0].delta.content).toBe("hi");
  });
  it("openAIDone", () => {
    expect(openAIDone()).toBe("data: [DONE]\n\n");
  });
});
