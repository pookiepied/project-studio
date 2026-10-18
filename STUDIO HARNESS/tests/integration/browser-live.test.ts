import { afterAll, describe, expect, it, vi } from "vitest";
import * as v from "valibot";
import { BrowserSession } from "../../src/browser/session.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";
import { engineReport } from "../../src/browser/resolve.js";

const session = new BrowserSession(createStudioUuid());
const viewerId = createStudioUuid();
afterAll(async () => { await session.close(); });

describe.skipIf(engineReport().seen === undefined)("live control of an installed browser", () => {
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
