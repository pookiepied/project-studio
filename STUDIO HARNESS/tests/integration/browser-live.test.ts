import { afterAll, describe, expect, it, vi } from "vitest";
import * as v from "valibot";
import { BrowserSession } from "../../src/browser/session.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";
import { engineReport } from "../../src/browser/resolve.js";

const session = new BrowserSession(createStudioUuid());
const viewerId = createStudioUuid();
afterAll(async () => { await session.close(); });

describe.skipIf(engineReport().seen === undefined)("live control of an installed browser", () => {
  it("reports viewer presence during automation without injecting input or stopping the agent", async () => {
    const tab = await session.page();
    await tab.page.setContent('<input aria-label="Untouched"><button>Target</button>');
    let release = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const work = session.live.agent(async () => { await barrier; return session.live.report({ content: [{ type: "text", text: "Continued." }] }); });
    await session.live.interact({ action: "activity", viewerId, tabId: tab.id, kind: "move", x: 0.3, y: 0.4 });
    await session.live.interact({ action: "activity", viewerId, tabId: tab.id, kind: "keyboard", x: 0.3, y: 0.4 });
    expect(await tab.page.locator("input").inputValue()).toBe("");
    release();
    const result = await work;
    expect(result.content[0]).toEqual({ type: "text", text: "Continued." });
    expect(result.structuredContent).toMatchObject({ userActivity: { moves: 1, keys: 1, pageInputs: 0, viewerOnly: 2, tabId: tab.id, x: 0.3, y: 0.4 } });
    expect(await session.live.interact({ action: "view", viewerId })).toMatchObject({ control: "agent" });
    const next = { content: [{ type: "text", text: "Next" }] };
    expect(session.live.report(next)).toBe(next);
    await expect(session.live.interact({ action: "activity", viewerId, tabId: "foreign-tab", kind: "move", x: 0, y: 0 })).rejects.toThrow();
    await session.live.interact({ action: "detach", viewerId });
  });

  it("projects actual cursor shape and button state and summarizes manual input without key contents", async () => {
    const tab = await session.page();
    await tab.page.setContent('<input aria-label="Private" style="position:absolute;left:0;top:0;width:200px;height:60px;cursor:text">');
    await session.live.interact({ action: "view", viewerId });
    await tab.page.mouse.move(40, 30);
    await tab.page.mouse.down();
    await expect.poll(() => session.live.interact({ action: "view", viewerId })).toMatchObject({ cursor: { kind: "text", pressed: true, pressSequence: 1 } });
    await tab.page.mouse.up();
    await expect.poll(() => session.live.interact({ action: "view", viewerId })).toMatchObject({ cursor: { kind: "text", pressed: false, pressSequence: 1 } });
    // A complete click between viewer reads must still leave bounded visual evidence.
    await tab.page.mouse.click(40, 30);
    await expect.poll(() => session.live.interact({ action: "view", viewerId })).toMatchObject({ cursor: { pressed: false, pressSequence: 2 } });
    expect(session.live.hasActivity).toBe(false);
    await session.live.interact({ action: "claim", viewerId });
    await session.live.interact({ action: "text", viewerId, tabId: tab.id, text: "private-text" });
    await session.live.interact({ action: "release", viewerId });
    const result = await session.live.agent(async () => session.live.report({ content: [] }));
    expect(result.structuredContent).toMatchObject({ userActivity: { edits: 1, pageInputs: 1, viewerOnly: 0 } });
    expect(JSON.stringify(result)).not.toContain("private-text");
    await tab.page.locator("input").evaluate((element) => { element.style.left = "2000px"; });
    await session.live.point(tab.page.locator("input"), tab.id);
    expect(await session.live.interact({ action: "view", viewerId })).toMatchObject({ cursor: null });
    await session.live.interact({ action: "detach", viewerId });
  });

  it("streams the same page, accepts human input, adopts popups and retains the session on detach", async () => {
    const tab = await session.page();
    await tab.page.setContent('<title>Live fixture</title><input aria-label="Name" style="position:absolute;left:0;top:0;width:200px;height:60px"><button onclick="window.open(\'about:blank\')">Popup</button>');
    await session.live.interact({ action: "view", viewerId });
    await expect.poll(async () => {
      const value = await session.live.interact({ action: "view", viewerId });
      return JSON.stringify(value).includes('"data":"');
    }).toBe(true);
    const before = v.parse(v.object({ frame: v.object({ sequence: v.number() }) }), await session.live.interact({ action: "view", viewerId }));
    const viewport = vi.spyOn(tab.page, "viewportSize").mockReturnValue({ width: 640, height: 400 });
    try {
      await tab.page.evaluate(() => { document.body.style.backgroundColor = "#ddd"; });
      await expect.poll(() => session.live.interact({ action: "view", viewerId, since: before.frame.sequence }))
        .toMatchObject({ frame: { width: 1280, height: 800 } });
    } finally { viewport.mockRestore(); }
    await tab.page.mouse.move(240, 160, { steps: 3 });
    await expect.poll(async () => {
      const value = await session.live.interact({ action: "view", viewerId });
      return JSON.stringify(value).includes('"x":0.1875,"y":0.2');
    }).toBe(true);
    const title = vi.spyOn(tab.page, "title").mockImplementation(() => new Promise<string>(() => {}));
    try {
      // A document waiting on navigation must not turn a healthy session into
      // an HTTP timeout, and concurrent polls must not accumulate evaluations.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(Promise.race([
        session.live.interact({ action: "view", viewerId }).then(() => "frame"),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
      ])).resolves.toBe("frame");
      await session.live.interact({ action: "view", viewerId });
      expect(title).toHaveBeenCalledTimes(1);
    } finally { title.mockRestore(); }
    await session.live.interact({ action: "claim", viewerId });
    await session.live.interact({ action: "pointer", viewerId, tabId: tab.id, kind: "down", x: 0.05, y: 0.04, button: "left", clicks: 1 });
    await session.live.interact({ action: "pointer", viewerId, tabId: tab.id, kind: "up", x: 0.05, y: 0.04, button: "left", clicks: 1 });
    await session.live.interact({ action: "text", viewerId, tabId: tab.id, text: "human input" });
    expect(await tab.page.locator("input").inputValue()).toBe("human input");
    await tab.page.evaluate(() => {
      document.addEventListener("keyup", (event) => document.body.dataset["released"] = event.key);
    });
    await session.live.interact({ action: "key", viewerId, tabId: tab.id, kind: "down", key: "Shift" });
    await session.live.interact({ action: "reset", viewerId });
    expect(await tab.page.locator("body").getAttribute("data-released")).toBe("Shift");
    await tab.page.evaluate(() => window.open("about:blank"));
    await expect.poll(() => session.tabIds.length).toBe(2);
    await session.live.interact({ action: "detach", viewerId });
    expect(session.running).toBe(true);
    expect(await tab.page.locator("input").inputValue()).toBe("human input");
    expect(await session.live.agent(async () => "resumed")).toBe("resumed");
  }, 30000);
});
