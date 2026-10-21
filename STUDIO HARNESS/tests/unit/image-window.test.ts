import type { Context, Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { imageWindowFor, OMITTED_IMAGE_TEXT, windowImages } from "../../src/gateway/language/image-window.js";

/** A PNG header of this size, padded to `bytes`, as base64. The window reads only the header. */
function png(width: number, height: number, bytes = 64): string {
  const data = Buffer.alloc(Math.max(24, bytes));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data.toString("base64");
}

const SCREEN = png(1568, 882);

function shot(index: number, data = SCREEN): Message {
  return {
    role: "toolResult",
    toolCallId: `call_${String(index)}`,
    toolName: "screenshot",
    content: [{ type: "text", text: `frame ${String(index)}` }, { type: "image", data, mimeType: "image/png" }],
    isError: false,
    timestamp: index + 1,
  };
}

/** A computer-use run: the request, then one screenshot per tool result. */
function run(screenshots: number, data?: (index: number) => string): Context {
  const messages: Message[] = [{ role: "user", content: "open the settings", timestamp: 0 }];
  for (let index = 0; index < screenshots; index += 1) messages.push(shot(index, data?.(index)));
  return { systemPrompt: "system", messages };
}

function images(context: Context): string[] {
  return context.messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content.flatMap((block) => (block.type === "image" ? [block.data] : [])) : []);
}

const WIDE = { maxImages: 50, maxBase64Chars: 100_000_000, step: 10 };

describe("the pictures one model request carries", () => {
  it("passes a request inside the window through as the same object", () => {
    const context = run(34);
    const windowed = windowImages(context);
    expect(windowed).toEqual({ context, omitted: 0, kept: 34 });
    expect(windowed.context).toBe(context);
  });

  it("keeps the newest fifty by default, says where older ones went, and leaves the transcript alone", () => {
    const context = run(60, (index) => png(1000 + index, 800));
    const windowed = windowImages(context);
    expect(windowed).toMatchObject({ omitted: 10, kept: 50 });
    expect(images(windowed.context)).toEqual(images(context).slice(10));
    expect(windowed.context.messages[1]?.content).toEqual([{ type: "text", text: "frame 0" }, { type: "text", text: OMITTED_IMAGE_TEXT }]);
    expect(images(context)).toHaveLength(60);
  });

  it("moves the cut in steps, so the same early pictures stay out for several turns", () => {
    const window = { maxImages: 20, maxBase64Chars: 100_000_000, step: 10 };
    for (const total of [21, 25, 30]) {
      expect(windowImages(run(total), window)).toMatchObject({ omitted: 10, kept: total - 10 });
    }
    expect(windowImages(run(34), window)).toMatchObject({ omitted: 20, kept: 14 });
    expect(windowImages(run(20), window).omitted).toBe(0);
  });

  it("uses a smaller step when the limit is small", () => {
    expect(windowImages(run(6), { maxImages: 4, maxBase64Chars: 100_000_000, step: 10 })).toMatchObject({ omitted: 2, kept: 4 });
  });

  it("stops at the byte total before the count, and never leaves a gap", () => {
    const context = run(10, () => png(800, 600, 300));
    const each = png(800, 600, 300).length;
    const windowed = windowImages(context, { maxImages: 50, maxBase64Chars: each * 3 + 1, step: 1 });
    expect(windowed).toMatchObject({ kept: 3, omitted: 7 });
    expect(images(windowed.context)).toEqual(images(context).slice(7));
  });

  it("always sends what the person just attached, even past the limits, and cuts tool pictures around it", () => {
    const context = run(10);
    const attached = [png(4032, 3024, 500), png(4032, 3024, 500)];
    context.messages.push({ role: "user", content: [{ type: "text", text: "and these" }, ...attached.map((data) => ({ type: "image" as const, data, mimeType: "image/png" }))], timestamp: 99 });
    context.messages.push(shot(100));
    const windowed = windowImages(context, { maxImages: 3, maxBase64Chars: 100_000_000, step: 1 });
    // The newest screenshot and both attachments ride; every older screenshot goes.
    expect(windowed).toMatchObject({ kept: 3, omitted: 10 });
    expect(images(windowed.context)).toEqual([...attached, SCREEN]);
  });

  it("keeps to twenty pictures when any is past 2000 px, as Anthropic requires", () => {
    const large = windowImages(run(25, (index) => (index === 3 ? png(3000, 2000) : SCREEN)), WIDE);
    expect(large).toMatchObject({ omitted: 10, kept: 15 });
    expect(windowImages(run(25), WIDE)).toMatchObject({ omitted: 0, kept: 25 });
  });

  it("treats a picture whose size cannot be read as large", () => {
    expect(windowImages(run(25, (index) => (index === 0 ? "bm90IGEgcGljdHVyZQ==" : SCREEN)), WIDE)).toMatchObject({ omitted: 10 });
  });

  it("leaves string-only messages and text blocks alone", () => {
    const windowed = windowImages(run(3), { maxImages: 1, maxBase64Chars: 1000, step: 1 });
    expect(windowed.context.messages[0]).toEqual({ role: "user", content: "open the settings", timestamp: 0 });
    expect(windowed.omitted).toBe(2);
  });

  it("lowers the count so pictures take at most a quarter of a small context", () => {
    expect(imageWindowFor(0).maxImages).toBe(50);
    expect(imageWindowFor(1_048_576).maxImages).toBe(50);
    expect(imageWindowFor(128_000).maxImages).toBe(20);
    expect(imageWindowFor(8_000).maxImages).toBe(1);
  });
});
