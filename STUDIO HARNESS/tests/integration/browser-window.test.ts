import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import * as v from "valibot";
import { BrowserSession } from "../../src/browser/session.js";
import { browserInteractionSchema } from "../../src/browser/interaction.js";
import { engineReport } from "../../src/browser/resolve.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";

const engine = new BrowserSession(createStudioUuid());
const viewer = new BrowserSession(createStudioUuid());
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let artifacts: string | undefined;
afterAll(async () => {
  await viewer.close();
  await engine.close();
  await server?.close();
  if (artifacts && process.env["STUDIO_BROWSER_KEEP_VISUALS"] !== "1") await rm(artifacts, { recursive: true, force: true });
});

/** The real client hook and UI over an isolated browser session, without a user home. */
describe.skipIf(engineReport().seen === undefined)("detached browser window end to end", () => {
  it("takes control, types in the existing page, opens a tab, and releases control", async () => {
    const tab = await engine.page();
    await tab.page.setContent('<title>Session fixture</title><main style="padding:40px;font:16px system-ui"><h1>Shared browser session</h1><label>Name <input aria-label="Name" style="width:240px;height:40px"></label></main>');
    const root = resolve("../STUDIO");
    artifacts = await mkdtemp(resolve(tmpdir(), "studio-browser-window-"));
    server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
      cacheDir: resolve(artifacts, "vite-cache"),
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      plugins: [{ name: "isolated-browser-window-fixture", enforce: "pre",
        resolveId(id, importer) {
          if ((id === "@/stores/workspace" || id.replaceAll("\\", "/").endsWith("/stores/workspace"))
            && importer?.replaceAll("\\", "/").endsWith("/useLiveBrowser.ts")) return "\0browser-workspace";
          if (id === "/__browser-entry.tsx") return id;
          return undefined;
        },
        load(id) {
          if (id === "\0browser-workspace") return `
            const post = async input => {
              const response = await fetch('/__browser-api', {method:'POST', body:JSON.stringify(input)});
              if (!response.ok) return {ok:false,error:{kind:'harness-error',message:'Fixture refused input',status:response.status}};
              return {ok:true,value:await response.json()};
            };
            const browser = {
              view: (_id, viewerId, since) => post({action:'view',viewerId,since}),
              interact: (_id, viewerId, command) => post({...command,viewerId})
            };
            export const useWorkspace = () => ({browser,storePhase:{status:'ready'},ensureStore:async()=>{}});`;
          if (id === "/__browser-entry.tsx") return `
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {MotionConfig} from 'framer-motion';
            import {AppearanceProvider} from '/src/design/theme';
            import {BrowserWindow} from '/src/features/browser/BrowserWindow';
            import '/src/index.css';
            createRoot(document.getElementById('root')).render(
              <MotionConfig reducedMotion="user"><AppearanceProvider initial={{theme:'light',uiSize:12,codeOffset:1,pointerCursor:false}}>
                <BrowserWindow conversationId="fixture" />
              </AppearanceProvider></MotionConfig>);`;
          return undefined;
        },
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            void (async () => {
            if (req.url === "/__browser-viewer") {
              res.setHeader("Content-Type", "text/html");
              res.end(await vite.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/__browser-entry.tsx"></script></body></html>'));
            } else if (req.url === "/__browser-api") {
              let body = "";
              for await (const chunk of req) body += String(chunk);
              try {
                const input = v.parse(browserInteractionSchema, JSON.parse(body));
                const result = await engine.live.interact(input);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              } catch { res.statusCode = 400; res.end('{}'); }
            } else next();
            })().catch(next);
          });
        },
      }],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === "string") throw new Error("Fixture server did not bind.");
    const page = (await viewer.page()).page;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/__browser-viewer`);
    await page.getByRole("button", { name: "Take control" }).click();
    await page.getByRole("button", { name: "Resume Studio" }).waitFor();
    await page.getByRole("img", { name: "Live browser page" }).waitFor();
    await expect.poll(async () => tab.page.viewportSize()?.height).not.toBe(800);
    const input = await tab.page.getByRole("textbox", { name: "Name" }).boundingBox();
    const surface = await page.getByRole("application", { name: "Live browser page" }).boundingBox();
    if (!input || !surface) throw new Error("Fixture page has no input surface.");
    const size = tab.page.viewportSize();
    if (!size) throw new Error("Fixture page has no viewport.");
    await page.mouse.click(surface.x + (input.x + 30) * surface.width / size.width,
      surface.y + (input.y + 20) * surface.height / size.height);
    await page.keyboard.type("Shared state");
    await expect.poll(() => tab.page.getByRole("textbox", { name: "Name" }).inputValue()).toBe("Shared state");
    await page.mouse.dblclick(surface.x + (input.x + 30) * surface.width / size.width,
      surface.y + (input.y + 20) * surface.height / size.height);
    await expect.poll(() => tab.page.getByRole("textbox", { name: "Name" }).evaluate((element) => {
      const field = element as HTMLInputElement;
      return (field.selectionEnd ?? 0) - (field.selectionStart ?? 0);
    })).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(artifacts, "light.png") });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: resolve(artifacts, "dark.png") });
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await expect.poll(() => engine.tabIds.length).toBe(2);
    await page.getByRole("button", { name: "Resume Studio" }).click();
    await page.getByRole("button", { name: "Take control" }).waitFor();
    expect(await engine.live.agent(async () => "agent resumed")).toBe("agent resumed");
    expect(errors).toEqual([]);
  }, 60000);
});
