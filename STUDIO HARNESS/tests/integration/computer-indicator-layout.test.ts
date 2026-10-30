import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserSession } from "../../src/browser/session.js";
import { engineReport } from "../../src/browser/resolve.js";
import { createStudioUuid } from "../../src/contracts/uuid.js";

const viewer = new BrowserSession(createStudioUuid());
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let artifacts: string | undefined;
let url = "";

afterAll(async () => {
  await viewer.close();
  await server?.close();
  if (artifacts && process.env["STUDIO_UI_KEEP_VISUALS"] !== "1") await rm(artifacts, { recursive: true, force: true });
});

/** Real fonts and component CSS in an isolated headless browser, never the user's desktop. */
describe.skipIf(engineReport().seen === undefined)("computer indicator typography", () => {
  beforeAll(async () => {
    artifacts = await mkdtemp(resolve(tmpdir(), "studio-indicator-layout-"));
    const root = resolve("../STUDIO");
    server = await createServer({ root, configFile: resolve(root, "vite.config.ts"),
      cacheDir: resolve(artifacts, "vite-cache"), server: { host: "127.0.0.1", port: 0, strictPort: false },
      plugins: [{ name: "isolated-computer-indicator-fixture", enforce: "pre",
        resolveId(id, importer) {
          if ((id === "@/platform/tauri" || id.replaceAll("\\", "/").endsWith("/platform/tauri"))
            && importer?.replaceAll("\\", "/").endsWith("/ComputerIndicatorWindow.tsx")) return "\0indicator-platform";
          if (id === "/__indicator-entry.tsx") return id;
          return undefined;
        },
        load(id) {
          if (id === "\0indicator-platform") return `
            export const requestComputerStop = async () => {};
            export const onComputerIndicatorChanged = async fn => { globalThis.__indicatorChanged = fn; return () => {}; };
            export const onComputerIndicatorStatus = async fn => { globalThis.__indicatorStatus = fn; return () => {}; };
            export const onComputerStopResult = async () => () => {};`;
          if (id === "/__indicator-entry.tsx") return `
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {MotionConfig} from 'framer-motion';
            import {AppearanceProvider} from '/src/design/theme';
            import {ComputerIndicatorWindow} from '/src/shell/ComputerIndicatorWindow';
            import '/src/index.css';
            createRoot(document.getElementById('root')).render(
              <MotionConfig reducedMotion="always"><AppearanceProvider initial={{theme:'light',uiSize:12,codeOffset:1,pointerCursor:false}}>
                <ComputerIndicatorWindow />
              </AppearanceProvider></MotionConfig>);`;
          return undefined;
        },
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== "/__indicator-viewer") { next(); return; }
            void vite.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/__indicator-entry.tsx"></script></body></html>')
              .then((html) => { res.setHeader("Content-Type", "text/html"); res.end(html); }).catch(next);
          });
        },
      }],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("The indicator fixture did not bind.");
    url = `http://127.0.0.1:${address.port}/__indicator-viewer`;
    console.log(`Computer indicator visual fixtures: ${artifacts}`);
  }, 30000);

  it("keeps the Stop slot stable when its label becomes Stopping", async () => {
    const page = (await viewer.page()).page;
    await page.setViewportSize({ width: 340, height: 48 });
    await page.goto(url);
    const button = page.getByRole("button", { name: "Stop", exact: true });
    await button.waitFor();
    await page.evaluate(async () => { await document.fonts.ready; });
    const before = await button.boundingBox();
    await button.click();
    const after = await page.getByRole("button", { name: "Stopping", exact: true }).boundingBox();
    expect(before).not.toBeNull(); expect(after).not.toBeNull();
    expect(after?.width).toBeCloseTo(before?.width ?? 0, 1);
  }, 30000);

  it("aligns both text baselines and fits every status at supported font sizes and display scales", async () => {
    const browser = (await viewer.page()).page.context().browser();
    if (!browser) throw new Error("The indicator fixture has no browser.");
    const labels = {
      active: "Studio is using your computer", paused: "Computer work is paused",
      demonstrating: "You have computer control", stopping: "Releasing computer control",
    };
    for (const scale of [1, 1.25, 1.5]) {
      const context = await browser.newContext({ viewport: { width: 340, height: 48 }, deviceScaleFactor: scale, acceptDownloads: false });
      try {
        const page = await context.newPage();
        await page.goto(url);
        await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
        await page.evaluate(async () => { await document.fonts.ready; });
        for (const dark of [false, true]) for (const size of [11, 12, 13, 14]) for (const [mode, label] of Object.entries(labels)) {
          await page.evaluate(({ dark, size, mode }) => {
            const scope = globalThis as typeof globalThis & { __indicatorChanged?: () => void; __indicatorStatus?: (value: string) => void };
            document.documentElement.classList.toggle("dark", dark);
            document.documentElement.style.setProperty("--ui-size", `${size}px`);
            if (!scope.__indicatorChanged || !scope.__indicatorStatus) throw new Error("The indicator fixture controls are not connected.");
            scope.__indicatorChanged(); scope.__indicatorStatus(mode);
          }, { dark, size, mode });
          const status = page.getByRole("status");
          await expect.poll(() => status.textContent()).toContain(label);
          // Theme changes animate button colour; measure and capture its settled state.
          await expect.poll(() => status.evaluate((element) => {
            const button = element.querySelector("button");
            return button && getComputedStyle(button).color === getComputedStyle(element).color;
          })).toBe(true);
          const metrics = await status.evaluate((element) => {
            const label = element.querySelector(":scope > span:last-of-type");
            const button = element.querySelector("button > span");
            if (!label || !button) throw new Error("The indicator text is missing.");
            const first = document.createRange(), last = document.createRange();
            first.selectNodeContents(label); last.selectNodeContents(button);
            const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return { topDelta: Math.abs(a.top - b.top), bottomDelta: Math.abs(a.bottom - b.bottom),
              left: bounds.left, right: bounds.right, textRight: a.right, buttonLeft: button.getBoundingClientRect().left };
          });
          const scenario = `${scale}/${size}/${dark}/${mode}`;
          expect(metrics.topDelta, scenario).toBeLessThanOrEqual(0.5);
          expect(metrics.bottomDelta, scenario).toBeLessThanOrEqual(0.5);
          expect(metrics.left, scenario).toBeGreaterThanOrEqual(0);
          expect(metrics.right, scenario).toBeLessThanOrEqual(340);
          expect(metrics.textRight, scenario).toBeLessThan(metrics.buttonLeft);
          if (artifacts && size === 12 && (scale === 1 || scale === 1.5) && (mode === "active" || mode === "stopping")) {
            await page.screenshot({ path: resolve(artifacts, `${dark ? "dark" : "light"}-${scale}-${mode}.png`), omitBackground: true });
          }
        }
      } finally { await context.close(); }
    }
  }, 60000);
});
