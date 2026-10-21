import { describe, expect, it } from "vitest";

import type { BrowserSession } from "../../src/browser/session.js";
import { toolByName } from "../../src/browser/tools.js";

/**
 * A screenshot stays within one picture's budget. Over it, the answer was
 * dropped by the MCP channel and the model waited out the request deadline
 * for a picture that had been taken (2026-10-21).
 */
function sessionWith(sizes: { png: number; jpeg: number }) {
  const taken: string[] = [];
  const page = {
    url: () => "https://example.test/",
    title: async () => "Example",
    screenshot: async (options: { type: "png" | "jpeg" }) => {
      taken.push(options.type);
      return Buffer.alloc(sizes[options.type], 1);
    },
  };
  const session = { page: async () => ({ id: "tab_1", page }) } as unknown as BrowserSession;
  return { session, taken };
}

const screenshot = toolByName("studio_browser_screenshot");

describe("a browser screenshot within budget", () => {
  it("keeps a PNG that fits", async () => {
    const { session, taken } = sessionWith({ png: 300_000, jpeg: 100_000 });
    const result = await screenshot?.run(session, {});
    expect(taken).toEqual(["png"]);
    expect(result?.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(JSON.stringify(result?.content[0])).not.toContain("JPEG");
  });

  it("sends a JPEG of the same view when the PNG is too large, and says so", async () => {
    const { session, taken } = sessionWith({ png: 2_500_000, jpeg: 400_000 });
    const result = await screenshot?.run(session, { fullPage: true });
    expect(taken).toEqual(["png", "jpeg"]);
    expect(result?.isError).toBeUndefined();
    expect(result?.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    expect(String(result?.content[0]?.["text"])).toMatch(/Sent as JPEG: as a PNG it was 2\.4 MB/);
  });

  it("refuses with a way forward when even the JPEG is too large", async () => {
    const { session } = sessionWith({ png: 9_000_000, jpeg: 3_000_000 });
    const result = await screenshot?.run(session, { fullPage: true });
    expect(result?.isError).toBe(true);
    expect(result?.content).toHaveLength(1);
    expect(String(result?.content[0]?.["text"])).toMatch(/viewport instead of the full page/);
  });
});
