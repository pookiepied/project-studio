import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { candidates } from "../../src/browser/resolve.js";
import { CHROME_SERVER_ID, chromeServerPath } from "../../src/extend/mcp/builtin.js";
import { McpConnection } from "../../src/extend/mcp/connection.js";
import { StdioChannel } from "../../src/extend/mcp/stdio-channel.js";

const chrome = candidates().find((candidate) => candidate.name === "Google Chrome")?.seenAt;
const entry = chromeServerPath();

async function windowId(context: BrowserContext, page: Page): Promise<number> {
  const cdp = await context.newCDPSession(page);
  try { return (await cdp.send("Browser.getWindowForTarget")).windowId; }
  finally { await cdp.detach(); }
}

describe.skipIf(chrome === undefined || entry === undefined)("bundled Chrome DevTools attachment", () => {
  it("uses a separate work window, allows an explicit existing tab, and detaches without closing Chrome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-chrome-test-"));
    const profile = process.platform === "win32" ? join(directory, "Google", "Chrome", "User Data")
      : process.platform === "darwin" ? join(directory, "Library", "Application Support", "Google", "Chrome")
        : join(directory, "google-chrome");
    const site = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(request.url?.startsWith("/existing")
        ? "<title>Existing signed-in fixture</title><p>Existing tab</p>"
        : '<title>Work fixture</title><label>Example <input></label><button onclick="document.body.append(\'Clicked\')">Next</button>');
    });
    let fixture: BrowserContext | undefined;
    let connection: McpConnection | undefined;
    try {
      site.listen(0, "127.0.0.1");
      await once(site, "listening");
      const address = site.address();
      if (address === null || typeof address === "string") throw new Error("No test site address.");
      const origin = `http://127.0.0.1:${address.port}`;
      await mkdir(profile, { recursive: true });
      fixture = await chromium.launchPersistentContext(profile, { executablePath: chrome!, args: ["--remote-debugging-port=0"] });
      const original = fixture.pages()[0]!;
      await original.goto(`${origin}/existing?private=fixture-secret`);

      const channel = await StdioChannel.start({ command: process.execPath, args: [entry!], cwd: directory, startupTimeoutMs: 50,
        env: { LOCALAPPDATA: directory, HOME: directory, CHROME_CONFIG_HOME: directory } });
      const mcp = new McpConnection(channel, { serverId: CHROME_SERVER_ID });
      connection = mcp;
      const invoke = (name: string, args: Record<string, unknown> = {}, owner = "owner") => mcp.request("tools/call", {
        name: `studio_chrome_${name}`, arguments: args, _meta: { "studio/conversation": owner },
      }) as Promise<{ content: { text: string }[]; isError?: boolean }>;
      const result = async (name: string, args?: Record<string, unknown>) => {
        const answer = await invoke(name, args);
        expect(answer.isError, answer.content[0]?.text).toBeUndefined();
        return answer.content[0]!.text;
      };

      await expect(mcp.request("tools/list", {})).resolves.toMatchObject({ tools: expect.arrayContaining([
        expect.objectContaining({ name: "studio_chrome_connect" }),
      ]) });
      await expect(invoke("tabs")).resolves.toMatchObject({ isError: true });
      await result("connect");
      expect(fixture.pages()).toHaveLength(1);
      await expect(invoke("tabs", {}, "other-owner")).resolves.toMatchObject({ isError: true });
      const existing = JSON.parse(await result("tabs")).tabs[0];
      expect(existing).toMatchObject({ origin, title: "Existing signed-in fixture", studioWork: false });
      expect(JSON.stringify(existing)).not.toContain("fixture-secret");
      const { tab } = JSON.parse(await result("open", { url: `${origin}/work` }));
      const work = fixture.pages().find((page) => page.url() === `${origin}/work`)!;
      expect(await windowId(fixture, work)).not.toBe(await windowId(fixture, original));
      expect(await work.locator("button").evaluate((button) => getComputedStyle(button).cursor)).toContain("data:image/svg+xml");
      const tree = await fixture.newCDPSession(work);
      try {
        const { nodes } = await tree.send("Accessibility.getFullAXTree");
        expect(nodes.some((node) => node.name?.value === "Chrome is being controlled by Studio")).toBe(true);
      } finally { await tree.detach(); }
      await result("fill", { tab, label: "Example", text: "Studio fixture" });
      expect(await work.locator("input").inputValue()).toBe("Studio fixture");
      await result("click", { tab, role: "button", name: "Next" });
      expect(await result("read", { tab })).toContain("Clicked");

      expect(await result("read", { tab: existing.tab })).toContain("Existing tab");
      expect(await work.locator("button").evaluate((button) => getComputedStyle(button).cursor)).toBe("default");
      expect(await original.locator("p").evaluate((p) => getComputedStyle(p).cursor)).toContain("data:image/svg+xml");
      await result("disconnect");
      expect(fixture.pages()).toHaveLength(2);
      expect(await original.locator("p").evaluate((p) => getComputedStyle(p).cursor)).toBe("auto");
    } finally {
      connection?.close();
      await connection?.whenExited();
      await fixture?.close();
      if (site.listening) await new Promise<void>((resolve) => site.close(() => resolve()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 45_000);
});
