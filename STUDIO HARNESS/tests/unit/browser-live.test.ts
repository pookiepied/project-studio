import { afterEach, describe, expect, it, vi } from "vitest";
import * as v from "valibot";
import { BrowserSession } from "../../src/browser/session.js";
import { browserInteractionSchema } from "../../src/browser/interaction.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";

const sessions: BrowserSession[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(sessions.splice(0).map((session) => session.close())); });

function session() {
  const value = new BrowserSession(createStudioUuid());
  sessions.push(value);
  return value;
}

describe("private live browser control", () => {
  it("refuses unbounded input, invalid coordinates and executable navigation schemes", () => {
    const viewerId = createStudioUuid();
    expect(v.safeParse(browserInteractionSchema, { action: "navigate", viewerId, tabId: "tab_1", url: "javascript:alert(1)" }).success).toBe(false);
    expect(v.safeParse(browserInteractionSchema, { action: "pointer", viewerId, tabId: "tab_1", kind: "down", x: 2, y: 0, button: "left", clicks: 1 }).success).toBe(false);
    expect(v.safeParse(browserInteractionSchema, { action: "text", viewerId, tabId: "tab_1", text: "x".repeat(16385) }).success).toBe(false);
    expect(v.safeParse(browserInteractionSchema, { action: "claim", viewerId, conversation: "someone-else" }).success).toBe(false);
  });

  it("does not launch a browser to view or claim, isolates owners and blocks agent work until release", async () => {
    const current = session();
    const viewerId = createStudioUuid();
    const other = createStudioUuid();
    await current.live.interact({ action: "claim", viewerId });
    expect(current.running).toBe(false);
    await expect(current.live.agent(async () => "acted")).rejects.toThrow("taken control");
    await expect(current.live.interact({ action: "claim", viewerId: other })).rejects.toThrow("Another window");
    await current.live.interact({ action: "release", viewerId: other });
    await expect(current.live.agent(async () => "acted")).rejects.toThrow("taken control");
    await current.live.interact({ action: "release", viewerId });
    expect(await current.live.agent(async () => "acted")).toBe("acted");
  });

  it("keeps conversation control separate and allows explicit stop during human control", async () => {
    const first = session();
    const second = session();
    await first.live.interact({ action: "claim", viewerId: createStudioUuid() });
    expect(await second.live.agent(async () => "second")).toBe("second");
    expect(await first.live.agent(async () => "quit", true)).toBe("quit");
  });

  it("expires abandoned control without granting the expired owner another input", async () => {
    const current = session();
    const viewerId = createStudioUuid();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await current.live.interact({ action: "claim", viewerId });
    clock.mockReturnValue(now + 8001);
    await expect(current.live.interact({ action: "new", viewerId })).rejects.toThrow("Take control");
    expect(await current.live.agent(async () => "resumed")).toBe("resumed");
  });

  it("bounds the live tab listing and reports omitted tabs without starting a browser", async () => {
    const current = session();
    vi.spyOn(current, "tabIds", "get").mockReturnValue(Array.from({ length: 200 }, (_, index) => `tab_${index}`));
    const state = await current.live.interact({ action: "view", viewerId: createStudioUuid() });
    expect(state).toHaveProperty("omittedTabs", 72);
    expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThan(1_048_576);
    expect(current.running).toBe(false);
  });

  it("serializes a take-over behind the current action", async () => {
    const current = session();
    let finish: (() => void) | undefined;
    const action = current.live.agent(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const claim = current.live.interact({ action: "claim", viewerId: createStudioUuid() });
    finish?.();
    await action;
    await claim;
    await expect(current.live.agent(async () => "unsafe overlap")).rejects.toThrow("taken control");
  });
});
