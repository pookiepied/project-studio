import type { Context, Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { OMITTED_IMAGE_TEXT, windowImages } from "../../src/gateway/language/image-window.js";

/** A computer-use run: the request, then one screenshot per tool result. */
function run(screenshots: number, size = 10): Context {
  const messages: Message[] = [{ role: "user", content: "open the settings", timestamp: 0 }];
  for (let index = 0; index < screenshots; index += 1) {
    messages.push({
      role: "toolResult",
      toolCallId: `call_${String(index)}`,
      toolName: "screenshot",
      content: [
        { type: "text", text: `frame ${String(index)}` },
        { type: "image", data: String(index % 10).repeat(size), mimeType: "image/png" },
      ],
      isError: false,
      timestamp: index + 1,
    });
  }
  return { systemPrompt: "system", messages };
}

function images(context: Context): string[] {
  return context.messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content.flatMap((block) => (block.type === "image" ? [block.data] : [])) : []);
}

describe("the pictures one model request carries", () => {
  it("passes a request already inside the window through as the same object", () => {
    const context = run(5);
    const windowed = windowImages(context, { maxImages: 20, maxBase64Chars: 1000, step: 1 });
    expect(windowed).toEqual({ context, omitted: 0, kept: 5 });
    expect(windowed.context).toBe(context);
  });

  it("keeps the newest pictures past the count and says where the older ones went", () => {
    const context = run(34);
    const windowed = windowImages(context, { maxImages: 20, maxBase64Chars: 1_000_000, step: 1 });
    expect(windowed).toMatchObject({ omitted: 14, kept: 20 });
    expect(images(windowed.context)).toEqual(images(context).slice(14));
    const oldest = windowed.context.messages[1]?.content;
    expect(oldest).toEqual([{ type: "text", text: "frame 0" }, { type: "text", text: OMITTED_IMAGE_TEXT }]);
    // The transcript itself is untouched: only the request is a projection.
    expect(images(context)).toHaveLength(34);
  });

  it("stops at the byte total before the count, and never leaves a gap", () => {
    const context = run(10, 100);
    context.messages.push({ role: "user", content: [{ type: "image", data: "x".repeat(50), mimeType: "image/png" }], timestamp: 99 });
    const windowed = windowImages(context, { maxImages: 20, maxBase64Chars: 260, step: 1 });
    // 50 + 100 + 100 = 250 fits; the next 100 does not, and nothing older rides.
    expect(windowed).toMatchObject({ kept: 3, omitted: 8 });
    expect(images(windowed.context)).toEqual([...images(context).slice(8, 10), "x".repeat(50)]);
  });

  it("leaves string-only messages and text blocks alone", () => {
    const windowed = windowImages(run(3), { maxImages: 1, maxBase64Chars: 1000, step: 1 });
    expect(windowed.context.messages[0]).toEqual({ role: "user", content: "open the settings", timestamp: 0 });
    expect(windowed.omitted).toBe(2);
  });

  it("moves the cut in steps, so the same early pictures stay out for several turns", () => {
    const window = { maxImages: 20, maxBase64Chars: 1_000_000, step: 10 };
    // 21 to 30 pictures all leave out the oldest ten: the start of the
    // request, which providers cache, does not change from turn to turn.
    for (const total of [21, 25, 30]) {
      expect(windowImages(run(total), window)).toMatchObject({ omitted: 10, kept: total - 10 });
    }
    expect(windowImages(run(34), window)).toMatchObject({ omitted: 20, kept: 14 });
    expect(windowImages(run(20), window).omitted).toBe(0);
  });

  it("always keeps the newest picture, even when it alone is over the byte limit", () => {
    const windowed = windowImages(run(3, 500), { maxImages: 20, maxBase64Chars: 100, step: 10 });
    expect(windowed).toMatchObject({ omitted: 2, kept: 1 });
  });
});
