import type { CDPSession, Locator, Page } from "playwright-core";
import type { BrowserSession } from "./session.js";
import type { BrowserInteraction } from "./interaction.js";
import { BrowserError } from "./errors.js";
import { createStudioUuid } from "../contracts/uuid.js";
import type { ToolAnswer } from "./result.js";

const LEASE_MS = 8000;

/** One bounded live frame and an exclusive, expiring human-control lease. */
export class LiveBrowser {
  #owner: string | undefined;
  #expires = 0;
  #viewed = 0;
  #agent = false;
  #tail: Promise<unknown> = Promise.resolve();
  #cdp: CDPSession | undefined;
  #page: Page | undefined;
  #frame: { data: string; sequence: number; tabId: string; width: number; height: number } | null = null;
  #sequence = 0;
  #frameUnavailable = false;
  #cursor: { x: number; y: number; tabId: string; kind?: "default" | "pointer" | "text"; pressed?: boolean; pressSequence?: number } | null = null;
  #pressSequence = 0;
  #activity: { moves: number; buttons: number; wheels: number; keys: number; edits: number; pageInputs: number; viewerOnly: number; tabId: string; x: number | null; y: number | null } | undefined;
  #timer: NodeJS.Timeout | undefined;
  readonly #held = new Map<Page, Set<string>>();
  #cursorBinding: { name: string; script: string } | undefined;
  #watching: Promise<void> | undefined;
  readonly #titles = new Map<Page, { value: string; readAt: number; pending: boolean }>();

  constructor(readonly session: BrowserSession) {}

  async agent<T>(run: () => Promise<T>, quitting = false): Promise<T> {
    return this.#serial(async () => {
      if (this.#owner !== undefined && !this.#owned()) {
        await this.#releaseKeys();
        this.#owner = undefined;
      }
      if (!quitting && this.#owned()) {
        throw new BrowserError("bad_input", { message: "The person has taken control of this browser. Wait for them to resume Studio before using browser tools." });
      }
      this.#agent = true;
      try { return await run(); } finally { this.#agent = false; }
    });
  }

  /** Coordinates are the actual target bounds, not an invented desktop pointer. */
  async point(locator: Locator, tabId: string): Promise<void> {
    if (Date.now() - this.#viewed > LEASE_MS) return;
    const box = await locator.boundingBox({ timeout: 1000 }).catch(() => null);
    const page = this.session.tab(tabId)?.page;
    const viewport = page?.viewportSize();
    if (box !== null && viewport) {
      const x = (box.x + box.width / 2) / viewport.width;
      const y = (box.y + box.height / 2) / viewport.height;
      this.#cursor = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y, tabId, pressSequence: this.#pressSequence } : null;
    }
  }

  async interact(input: BrowserInteraction): Promise<unknown> {
    if (input.action === "activity") {
      if (this.session.tab(input.tabId) === undefined) throw new BrowserError("no_tab");
      // Viewer presence never claims control or injects input into the page.
      this.#recordActivity(input.kind, input.tabId, input.x, input.y, false);
      return { accepted: true };
    }
    if (input.action === "view") {
      this.#viewed = Date.now();
      if (this.#owner === input.viewerId && this.#owned()) this.#expires = Date.now() + LEASE_MS;
      if (this.session.running) {
        const tab = this.session.activeTabId;
        if (tab !== undefined) {
          const watching = this.#watching ?? this.#watch(this.session.tab(tab)?.page, tab);
          this.#watching = watching;
          try { await watching; }
          catch (error) { await this.#unwatch(); throw error; }
          finally { if (this.#watching === watching) this.#watching = undefined; }
        }
        this.session.keepAlive();
      }
      return this.#state(input.viewerId, input.since);
    }
    return this.#serial(async () => {
      if (input.action === "claim") {
        if (this.#owner !== undefined && !this.#owned()) await this.#releaseKeys();
        if (this.#owned() && this.#owner !== input.viewerId) {
          throw new BrowserError("bad_input", { message: "Another window is controlling this browser." });
        }
        this.#owner = input.viewerId;
        this.#expires = Date.now() + LEASE_MS;
      } else if (input.action === "release" || input.action === "detach") {
        if (this.#owner === input.viewerId) {
          await this.#releaseKeys();
          this.#owner = undefined;
        }
        if (input.action === "detach") {
          await this.#watching?.catch(() => undefined);
          await this.#unwatch();
        }
      } else {
        if (!this.#owned() || this.#owner !== input.viewerId) {
          throw new BrowserError("bad_input", { message: "Take control before interacting with the browser." });
        }
        this.#expires = Date.now() + LEASE_MS;
        if (!this.session.running) throw new BrowserError("no_tab", { message: "This browser session has ended. Ask Studio to open a page again." });
        if (input.action === "reset") {
          await this.#releaseKeys();
        } else if (input.action === "new") {
          this.#recordActivity("edit", "", null, null, true);
          await this.session.newTab();
        } else if (input.action === "close") {
          this.#recordActivity("edit", input.tabId, null, null, true);
          await this.session.closeTab(input.tabId);
        } else {
          const tab = this.session.tab(input.tabId);
          if (tab === undefined) throw new BrowserError("no_tab");
          if (input.action === "select") {
            this.#recordActivity("edit", tab.id, null, null, true);
            this.session.selectTab(tab.id);
          }
          else {
            this.#recordActivity(input.action === "pointer" ? input.kind === "move" ? "move" : "button"
              : input.action === "wheel" ? "wheel" : input.action === "key" ? "keyboard" : "edit", tab.id,
              input.action === "pointer" ? input.x : null, input.action === "pointer" ? input.y : null, true);
            await this.#input(tab.page, input);
          }
        }
        this.session.keepAlive();
      }
      return { accepted: true };
    });
  }

  #owned(): boolean { return this.#owner !== undefined && this.#expires > Date.now(); }

  #recordActivity(kind: string, tabId: string, x: number | null, y: number | null, pageInput: boolean): void {
    const value = this.#activity ?? { moves: 0, buttons: 0, wheels: 0, keys: 0, edits: 0, pageInputs: 0, viewerOnly: 0, tabId, x, y };
    const field = kind === "move" ? "moves" : kind === "button" ? "buttons" : kind === "wheel" ? "wheels" : kind === "keyboard" ? "keys" : "edits";
    value[field] = Math.min(1_000_000, value[field] + 1);
    const source = pageInput ? "pageInputs" : "viewerOnly";
    value[source] = Math.min(1_000_000, value[source] + 1);
    if (value.tabId !== tabId) { value.x = null; value.y = null; }
    value.tabId = tabId;
    if (x !== null && y !== null) { value.x = x; value.y = y; }
    this.#activity = value;
  }

  get hasActivity(): boolean { return this.#activity !== undefined; }

  report(result: ToolAnswer): ToolAnswer {
    const activity = this.#activity;
    if (activity === undefined) return result;
    this.#activity = undefined;
    const activeTabId = this.session.activeTabId ?? null;
    const content = `User activity in Studio Browser: ${JSON.stringify(activity)}. Coordinates are fractions of the viewport. viewerOnly counts coalesced activity samples that did not send input to the page; pageInputs counts submitted viewer commands, not verified application results. Current active tab: ${activeTabId ?? "none"}. Key values and entered text were not collected for this report. This activity does not automatically stop browser use. Reobserve the page if the person interacted with it.`;
    return { ...result, content: [...result.content, { type: "text", text: content }], structuredContent: { ...result.structuredContent, userActivity: { ...activity, activeTabId } } };
  }

  async #serial<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    const next = previous.then(run, run);
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async #input(page: Page, input: Exclude<BrowserInteraction, { action: "view" | "activity" | "claim" | "release" | "detach" | "new" | "close" | "select" | "reset" }>): Promise<void> {
    switch (input.action) {
      case "navigate": await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 10000 }); break;
      case "back": await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }); break;
      case "forward": await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 }); break;
      case "reload": await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 }); break;
      case "resize": await page.setViewportSize({ width: input.width, height: input.height }); break;
      case "pointer": {
        const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
        await page.mouse.move(input.x * viewport.width, input.y * viewport.height);
        if (input.kind === "down") await page.mouse.down({ button: input.button, clickCount: input.clicks });
        if (input.kind === "up") await page.mouse.up({ button: input.button, clickCount: input.clicks });
        break;
      }
      case "wheel": await page.mouse.wheel(input.x, input.y); break;
      case "key":
        if (input.kind === "down") {
          await page.keyboard.down(input.key);
          const held = this.#held.get(page) ?? new Set<string>();
          held.add(input.key);
          this.#held.set(page, held);
        } else {
          await page.keyboard.up(input.key);
          this.#held.get(page)?.delete(input.key);
        }
        break;
      case "text": await page.keyboard.insertText(input.text); break;
    }
  }

  #state(viewerId: string, since?: number): unknown {
    const ids = this.session.tabIds;
    const active = this.session.activeTabId;
    const ordered = active ? [active, ...ids.filter((id) => id !== active)] : ids;
    const tabs: { id: string; url: string; title: string }[] = [];
    const pages = new Set(ordered.slice(0, 128).map((id) => this.session.tab(id)?.page));
    for (const page of this.#titles.keys()) if (!pages.has(page)) this.#titles.delete(page);
    let bytes = 0;
    for (const id of ordered.slice(0, 128)) {
      const page = this.session.tab(id)?.page;
      let title = page ? this.#titles.get(page) : undefined;
      if (page && (!title || (!title.pending && Date.now() - title.readAt >= 1000))) {
        title ??= { value: "", readAt: 0, pending: false };
        const entry = title;
        this.#titles.set(page, entry);
        entry.pending = true;
        // A title evaluation can wait for navigation. It must never hold the
        // frame, lease renewal or connection health hostage to that document.
        void page.title().then((value) => { entry.value = value.slice(0, 1024); }, () => undefined)
          .finally(() => { entry.pending = false; entry.readAt = Date.now(); });
      }
      const tab = { id, url: (page?.url() ?? "").slice(0, 8192), title: title?.value ?? "" };
      bytes += Buffer.byteLength(JSON.stringify(tab));
      if (bytes > 200_000) break;
      tabs.push(tab);
    }
    tabs.sort((first, second) => ids.indexOf(first.id) - ids.indexOf(second.id));
    return { running: this.session.running, activeTabId: this.session.activeTabId ?? null, tabs,
      control: this.#owned() ? this.#owner === viewerId ? "human" : "other" : "agent",
      busy: this.#agent, cursor: this.#cursor, omittedTabs: ids.length - tabs.length, frameUnavailable: this.#frameUnavailable,
      frame: this.#frame !== null && this.#frame.sequence !== since ? this.#frame : null };
  }

  async #watch(page: Page | undefined, tabId: string): Promise<void> {
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => {
        if (Date.now() - this.#viewed > LEASE_MS) {
          void this.#serial(async () => {
            if (this.#owner !== undefined && !this.#owned()) {
              await this.#releaseKeys();
              this.#owner = undefined;
            }
            await this.#unwatch();
          });
        }
      }, LEASE_MS);
      this.#timer.unref();
    }
    if (page === this.#page || page === undefined) return;
    await this.#unwatch(false);
    this.#page = page;
    const cdp = await page.context().newCDPSession(page);
    this.#cdp = cdp;
    const binding = `__studio_cursor_${createStudioUuid().replaceAll("-", "")}`;
    // Only numeric viewport coordinates cross this page-owned binding. Page
    // content has no authority to invoke controls or submit diagnostic data.
    const source = `(() => {
      const name = ${JSON.stringify(binding)};
      let last = 0, pending = null, timer;
      const publish = () => {
        if (!pending) return;
        const value = pending; pending = null; last = performance.now();
        try { globalThis[name](JSON.stringify(value)); } catch {}
      };
      const move = event => {
        if (!event.isTrusted) return;
        const cursor = event.target instanceof Element ? getComputedStyle(event.target).cursor : 'default';
        const kind = cursor === 'pointer' ? 'pointer' : cursor === 'text' ? 'text' : 'default';
        pending = { x: event.clientX, y: event.clientY, kind, pressed: event.buttons !== 0, press: event.type === 'mousedown' };
        if (event.type !== 'mousemove' || performance.now() - last >= 33) {
          clearTimeout(timer); timer = undefined; publish();
        } else if (timer === undefined) timer = setTimeout(() => { timer = undefined; publish(); }, 33);
      };
      const events = ['mousemove', 'mousedown', 'mouseup'];
      globalThis[name + '_stop'] = () => { clearTimeout(timer); events.forEach(event => removeEventListener(event, move, true)); };
      events.forEach(event => addEventListener(event, move, true));
    })()`;
    await cdp.send("Runtime.addBinding", { name: binding });
    cdp.on("Runtime.bindingCalled", (event) => {
      if (this.#cdp !== cdp || event.name !== binding || event.payload.length > 128) return;
      try {
        const value: unknown = JSON.parse(event.payload);
        const viewport = page.viewportSize();
        if (viewport && typeof value === "object" && value !== null && "x" in value && "y" in value
          && typeof value.x === "number" && Number.isFinite(value.x) && value.x >= 0 && value.x <= viewport.width
          && typeof value.y === "number" && Number.isFinite(value.y) && value.y >= 0 && value.y <= viewport.height) {
          const pressed = "pressed" in value && value.pressed === true;
          if ("press" in value && value.press === true && this.#pressSequence < Number.MAX_SAFE_INTEGER) this.#pressSequence++;
          this.#cursor = { tabId, x: value.x / viewport.width, y: value.y / viewport.height,
            kind: "kind" in value && value.kind === "pointer" ? "pointer" : "kind" in value && value.kind === "text" ? "text" : "default",
            pressed, pressSequence: this.#pressSequence };
        }
      } catch { /* A page cannot break the browser by sending malformed cursor telemetry. */ }
    });
    const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
    this.#cursorBinding = { name: binding, script: script.identifier };
    cdp.on("Page.frameNavigated", (event) => { if (this.#cdp === cdp && !event.frame.parentId) this.#cursor = null; });
    await cdp.send("Runtime.evaluate", { expression: source });
    cdp.on("Page.screencastFrame", (event) => {
      if (this.#cdp !== cdp) return;
      // One latest frame, bounded by both the capture dimensions and bytes.
      this.#frameUnavailable = event.data.length > 700_000;
      if (!this.#frameUnavailable) {
        this.#frame = { data: event.data, sequence: ++this.#sequence, tabId,
          width: event.metadata.deviceWidth, height: event.metadata.deviceHeight };
      } else this.#frame = null;
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1600, maxHeight: 1200 });
    await page.bringToFront();
  }

  async #releaseKeys(): Promise<void> {
    for (const id of this.session.tabIds) {
      const page = this.session.tab(id)?.page;
      if (page === undefined) continue;
      for (const key of this.#held.get(page) ?? []) await page.keyboard.up(key).catch(() => undefined);
      for (const button of ["left", "middle", "right"] as const) await page.mouse.up({ button }).catch(() => undefined);
    }
    this.#held.clear();
  }

  async #unwatch(clearTimer = true): Promise<void> {
    const cdp = this.#cdp;
    const binding = this.#cursorBinding;
    this.#cursorBinding = undefined;
    this.#cdp = undefined;
    this.#page = undefined;
    this.#cursor = null;
    this.#frame = null;
    this.#frameUnavailable = false;
    if (clearTimer && this.#timer !== undefined) { clearInterval(this.#timer); this.#timer = undefined; }
    if (cdp && binding) {
      await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: binding.script }).catch(() => undefined);
      await cdp.send("Runtime.evaluate", { expression: `globalThis[${JSON.stringify(binding.name + "_stop")}]?.(); delete globalThis[${JSON.stringify(binding.name + "_stop")}];` }).catch(() => undefined);
      await cdp.send("Runtime.removeBinding", { name: binding.name }).catch(() => undefined);
    }
    await cdp?.detach().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.#titles.clear();
    this.#owner = undefined;
    this.#held.clear();
    this.#cursor = null;
    this.#activity = undefined;
    await this.#watching?.catch(() => undefined);
    await this.#unwatch();
  }
}
