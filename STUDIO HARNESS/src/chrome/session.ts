import { chromium, type Browser, type Page } from "playwright-core";
import { createStudioUuid } from "../contracts/uuid.js";
import { readChromeEndpoint } from "./endpoint.js";
import { hideChromePointer, showChromePointer } from "./pointer.js";

const TIMEOUT = 8_000;
const IDLE_MS = 90_000;
const SETUP = "Open Google Chrome 144 or later, enable remote debugging at chrome://inspect/#remote-debugging, and click Allow when Chrome asks to connect.";

export class ChromeUsageError extends Error {}

export function webUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url : undefined;
  } catch { return undefined; }
}

/** One connection to the person's browser, exclusively owned by one conversation. */
export class ChromeSession {
  #owner: string | undefined;
  #browser: Browser | undefined;
  #working = false;
  #finished = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #tabIds = new WeakMap<Page, string>();
  #work: Page | undefined;
  #marked: Page | undefined;
  readonly #marker = `studio-chrome-${createStudioUuid()}`;

  constructor(readonly endpoint: () => Promise<string | undefined> = readChromeEndpoint) {}

  async run<T>(owner: string, work: () => Promise<T>): Promise<T> {
    if (this.#finished) throw new ChromeUsageError("Chrome DevTools by Studio is shutting down.");
    if (this.#owner !== undefined && this.#owner !== owner) {
      throw new ChromeUsageError("Another Studio conversation is using Chrome. Disconnect it before connecting here.");
    }
    if (this.#working) throw new ChromeUsageError("A Chrome action is already running. Wait for its result.");
    this.#working = true;
    this.#owner = owner;
    clearTimeout(this.#timer);
    try {
      return await work();
    } finally {
      this.#working = false;
      if (this.#browser === undefined) this.#owner = undefined;
      else this.#timer = setTimeout(() => { void this.disconnect().catch(() => undefined); }, IDLE_MS).unref();
    }
  }

  async connect(): Promise<void> {
    if (this.#browser?.isConnected()) return;
    const endpoint = await this.endpoint().catch(() => undefined);
    if (endpoint === undefined) throw new ChromeUsageError(SETUP);
    const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: 20_000 })
      .catch(() => { throw new ChromeUsageError(`Studio could not connect to Chrome. ${SETUP}`); });
    if (this.#finished) {
      await browser.close();
      throw new ChromeUsageError("Chrome DevTools by Studio is shutting down.");
    }
    this.#browser = browser;
    browser.once("disconnected", () => {
      if (this.#browser !== browser) return;
      this.#reset();
      if (!this.#working) this.#owner = undefined;
    });
  }

  #connected(): Browser {
    if (!this.#browser?.isConnected()) throw new ChromeUsageError("Connect to Chrome first. Studio does not reconnect or replay actions automatically.");
    return this.#browser;
  }

  #pages(): Page[] {
    return this.#connected().contexts()[0]?.pages() ?? [];
  }

  #id(page: Page): string {
    const id = this.#tabIds.get(page) ?? createStudioUuid();
    this.#tabIds.set(page, id);
    return id;
  }

  async tabs() {
    const pages = this.#pages().filter((page) => webUrl(page.url()) !== undefined);
    const tabs = await Promise.all(pages.slice(0, 32).map(async (page) => ({
      tab: this.#id(page),
      origin: webUrl(page.url())?.origin,
      title: (await page.title().catch(() => "")).slice(0, 160),
      studioWork: page === this.#work,
    })));
    return { tabs, truncated: pages.length > tabs.length };
  }

  async open(url: URL): Promise<string> {
    if (this.#work === undefined || this.#work.isClosed()) {
      const browser = this.#connected();
      const context = browser.contexts()[0];
      if (context === undefined) throw new ChromeUsageError("Chrome has no available browser profile.");
      const marker = `about:blank#${createStudioUuid()}`;
      const cdp = await browser.newBrowserCDPSession();
      try {
        const [page] = await Promise.all([
          context.waitForEvent("page", { predicate: (page) => page.url() === marker, timeout: TIMEOUT }),
          cdp.send("Target.createTarget", { url: marker, newWindow: true }),
        ]);
        this.#work = page;
      } finally { await cdp.detach().catch(() => undefined); }
    }
    await this.#work.goto(url.href, { timeout: TIMEOUT, waitUntil: "domcontentloaded" });
    if (webUrl(this.#work.url()) === undefined) throw new ChromeUsageError("The Chrome work tab did not land on a web page.");
    await this.#mark(this.#work);
    return this.#id(this.#work);
  }

  async page(id: string): Promise<Page> {
    const page = this.#pages().find((candidate) => this.#tabIds.get(candidate) === id);
    if (page === undefined || webUrl(page.url()) === undefined) {
      throw new ChromeUsageError("That Chrome tab is unavailable. List the Chrome tabs again before acting.");
    }
    await this.#mark(page);
    return page;
  }

  async #mark(page: Page): Promise<void> {
    if (this.#marked !== page) {
      const previous = this.#marked;
      previous?.off("domcontentloaded", this.#refreshPointer);
      this.#marked = page;
      page.on("domcontentloaded", this.#refreshPointer);
      if (previous !== undefined) await hideChromePointer(previous, this.#marker).catch(() => undefined);
    }
    await showChromePointer(page, this.#marker).catch(() => undefined);
  }

  #refreshPointer = (page: Page): void => {
    if (page === this.#marked && webUrl(page.url()) !== undefined) {
      void showChromePointer(page, this.#marker).catch(() => undefined);
    }
  };

  #reset(): void {
    clearTimeout(this.#timer);
    this.#browser = undefined;
    this.#work = undefined;
    this.#marked?.off("domcontentloaded", this.#refreshPointer);
    this.#marked = undefined;
    this.#tabIds = new WeakMap();
  }

  async disconnect(): Promise<void> {
    const browser = this.#browser;
    const marked = this.#marked;
    const wasWorking = this.#working;
    this.#working = true;
    this.#reset();
    try {
      if (marked !== undefined) await hideChromePointer(marked, this.#marker).catch(() => undefined);
      // Playwright closes its transport when attached over CDP, not the browser.
      await browser?.close();
    } finally {
      this.#working = wasWorking;
      if (!wasWorking) this.#owner = undefined;
    }
  }

  async finish(): Promise<void> {
    this.#finished = true;
    await this.disconnect().catch(() => undefined);
  }
}
