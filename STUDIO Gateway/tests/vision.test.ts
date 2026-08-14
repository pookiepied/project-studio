import { describe, it, expect } from "vitest";
import { needsVisionFallback } from "../src/gateway/resolver.ts";
import { DOCUMENT_CLASSIFY_BYTES, DOCUMENT_SCANNED_THRESHOLD_BYTES } from "../src/providers/shared/document.ts";
import { PROVIDER_CAPABILITIES } from "../src/providers/capabilities.ts";

const nonVision = { supports_vision: 0 } as { supports_vision: number };
const vision = { supports_vision: 1 } as { supports_vision: number };

describe("needsVisionFallback", () => {
  it("detects image_url block", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] } as never)).toBe(true);
  });
  it("detects image block", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }] }] } as never)).toBe(true);
  });
  it("detects file block (pdf)", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "file", file: { data: "abc", mediaType: "application/pdf" } }] }] } as never)).toBe(true);
  });
  it("detects document block", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "document", document: { data: "abc" } }] }] } as never)).toBe(true);
  });
  it("detects inlineData (google)", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "inlineData", inlineData: { mimeType: "image/jpeg", data: "abc" } }] }] } as never)).toBe(true);
  });
  it("detects data URL in string content", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: "data:image/png;base64,abc" }] } as never)).toBe(true);
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "text", text: "hi data:application/pdf;base64,abc" }] }] } as never)).toBe(false); // only string content top-level checked, array block with string not vision
  });
  it("detects data URL inside block url field", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] }] } as never)).toBe(true);
  });
  it("does not trigger for text-only", () => {
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: "hi" }] } as never)).toBe(false);
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never)).toBe(false);
  });
  it("does not trigger when model supports vision", () => {
    expect(needsVisionFallback(vision, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] } as never)).toBe(false);
  });
  it("handles missing or malformed messages", () => {
    expect(needsVisionFallback(nonVision, {} as never)).toBe(false);
    expect(needsVisionFallback(nonVision, { messages: "not-array" } as never)).toBe(false);
    expect(needsVisionFallback(nonVision, { messages: [{ role: "user" }] } as never)).toBe(false);
  });
  it("uses constants for thresholds (no hardcode)", () => {
    expect(DOCUMENT_CLASSIFY_BYTES).toBe(8000);
    expect(DOCUMENT_SCANNED_THRESHOLD_BYTES).toBe(4000);
  });
});

describe("capabilities without premature OCR", () => {
  it("anthropic/google/openai do not claim vision.pdf or document.ocr until real OCR", () => {
    expect(PROVIDER_CAPABILITIES.anthropic.operations.has("vision.pdf" as never)).toBe(false);
    expect(PROVIDER_CAPABILITIES.anthropic.operations.has("document.ocr" as never)).toBe(false);
    expect(PROVIDER_CAPABILITIES.google.operations.has("vision.pdf" as never)).toBe(false);
    expect(PROVIDER_CAPABILITIES.google.operations.has("document.ocr" as never)).toBe(false);
    expect(PROVIDER_CAPABILITIES.openai.operations.has("vision.pdf" as never)).toBe(false);
    expect(PROVIDER_CAPABILITIES.openai.operations.has("document.ocr" as never)).toBe(false);
  });
});
