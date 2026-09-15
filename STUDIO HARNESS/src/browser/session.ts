import type { Browser, BrowserContext, ConsoleMessage, Page, Request, Response } from "playwright-core";
import { chromium } from "playwright-core";

import { likelyChannels, noBrowserMessage, type BrowserChannel } from "./resolve.js";
import { BrowserError } from "./errors.js";

/**
 * One browser, its tabs, and the reasons it is allowed to exist.
 *
 * Four states are kept apart on purpose (ADR 0049 §4), and this class is only
 * the last one. Enabled costs nothing, announced costs a sentence, loaded
 * costs the schemas — and *running* costs 150 to 300 megabytes, so nothing
 * here happens until a tool is actually called. `page()` is the only door,
 * and it is the only place a browser is ever launched.
 *
 * **An idle browser closes itself.** Some minutes with no call and the process
 * ends; the next call starts another one. The model is never told, because a
 * tool that works either way has nothing to report — what it would produce is
 * a sentence the model has to reason about for no gain.
 *
 * **The profile is ours and it is disposable.** Never the person's real
 * profile, on any platform, ever: their cookies, their history and their saved
 * passwords are not ours to hand to a model. That means a site the person is
 * signed into is a site this browser is signed out of, which is the correct
 * trade and worth saying out loud, because it is the first thing that will
 * surprise someone.
 *
 * **And it lives exactly as long as the process.** The context is in-memory:
 * nothing is written to disk, so there is no profile directory to name, to
 * clean up, or to leak between two harnesses. The price is that the idle
 * close above forgets everything - a sign-in, a cookie, a half-filled form -
 * and the next call starts from nothing. That is the documented trade (ADR
 * 0049 §4, "carries a browser's memory until it goes idle"), chosen over a
 * persistent profile because a directory of cookies is a thing that has to be
 * managed, and managing it is the second product the ADR refuses to build.
 */

/** How long a browser may sit unused before it closes itself. */
const IDLE_MS = 5 * 60 * 1000;

/** How much console and network history one session remembers per tab. */
const LOG_LIMIT = 200;

interface ConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly at: number;
}

interface NetworkEntry {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly type: string;
  readonly at: number;
}

/**
 * What one tab is, beyond its page.
 *
 * The console and the network log are kept here rather than fetched on demand
 * because neither can be asked for after the fact: a message is emitted once,
 * and a listener that was not attached when it happened has nothing to read.
 * This is the whole reason a session exists as an object instead of a
 * function that returns a page.
 */
interface Tab {
  readonly id: string;
  readonly page: Page;
  readonly console: ConsoleEntry[];
  readonly network: NetworkEntry[];
  readonly bodies: Map<string, Response>;
}

export class BrowserSession {
  #browser: Browser | undefined;
  #context: BrowserContext | undefined;
  #channel: BrowserChannel | undefined;
  readonly #tabs = new Map<string, Tab>();
  #active: string | undefined;
  #counter = 0;
  #idle: NodeJS.Timeout | undefined;
  #closing: Promise<void> | undefined;

  /**
   * @param key Which conversation this browser belongs to. Isolation between
   *   conversations comes from each session owning its own browser and
   *   context, not from anything on disk; the key is what the server's
   *   session map is indexed by, and what a status line names.
   */
  constructor(readonly key: string) {}

  /** Which browser is running, for the status a person reads. */
  get channel(): BrowserChannel | undefined {
    return this.#channel;
  }

  get running(): boolean {
    return this.#browser !== undefined;
  }

  get tabIds(): readonly string[] {
    return [...this.#tabs.keys()];
  }

  get activeTabId(): string | undefined {
    return this.#active;
  }

  /**
   * Launches, or says plainly why it cannot.
   *
   * Every channel is tried in turn, because a machine with Chrome and no Edge
   * is ordinary and refusing it would be absurd. Only when all of them fail
   * does the refusal appear, and it carries the last real error alongside the
   * three facts, because "Edge is not installed" and "Edge is installed and
   * crashed" need different actions from the person reading it.
   */
  async #launch(): Promise<Browser> {
    const existing = this.#browser;
    if (existing !== undefined) return existing;

    let lastError = "";
    for (const channel of likelyChannels()) {
      try {
        // No `executablePath`, ever. A channel names a browser the person
        // installed; a path would be one we found, and the step after finding
        // one is downloading one when we cannot. That step does not exist.
        const browser = await chromium.launch({ channel, headless: true });
        this.#browser = browser;
        this.#channel = channel;
        this.#context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          // Ours, disposable, and never the person's: a fresh in-memory
          // context, not a profile on disk. Downloads are refused because a
          // file arriving on the machine is a policy question this tool does
          // not answer (ADR 0049 §7).
          acceptDownloads: false,
        });
        browser.on("disconnected", () => {
          // Chromium can die on its own — a crash, a task manager, an update
          // replacing the binary underneath it. Forgetting it here is what
          // lets the next call start a fresh one instead of handing out
          // handles to a process that is gone.
          this.#forget();
        });
        return browser;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new BrowserError("no_browser", { message: noBrowserMessage(lastError) });
  }

  /**
   * A tab to act on: the named one, the active one, or a new one.
   *
   * This is the only door to a running browser, so it is also the only place
   * the idle timer is renewed. A call that reaches a page has, by definition,
   * just used the browser.
   */
  async page(tabId?: string): Promise<Tab> {
    await this.#launch();
    this.#touch();

    if (tabId !== undefined) {
      const tab = this.#tabs.get(tabId);
      if (tab === undefined) {
        throw new BrowserError("no_tab", {
          message: `There is no tab "${tabId}". Open tabs: ${this.tabIds.join(", ") || "none"}.`,
        });
      }
      this.#active = tabId;
      return tab;
    }

    const active = this.#active === undefined ? undefined : this.#tabs.get(this.#active);
    if (active !== undefined) return active;
    return this.newTab();
  }

  /** Opens a tab and starts listening to it. */
  async newTab(): Promise<Tab> {
    await this.#launch();
    this.#touch();
    const context = this.#context;
    if (context === undefined) {
      throw new BrowserError("internal", { message: "The browser context did not start." });
    }

    this.#counter += 1;
    const id = `tab_${this.#counter}`;
    const page = await context.newPage();
    const tab: Tab = { id, page, console: [], network: [], bodies: new Map() };

    // Attached now, because none of this can be asked for later. A console
    // message is emitted once; a listener added after the fact reads silence
    // and reports a clean page that was never clean.
    page.on("console", (message: ConsoleMessage) => {
      push(tab.console, { level: message.type(), text: message.text(), at: Date.now() });
    });
    page.on("pageerror", (error: Error) => {
      push(tab.console, { level: "error", text: error.message, at: Date.now() });
    });
    page.on("requestfinished", (request: Request) => {
      void request.response().then((response) => {
        const entryId = `req_${tab.network.length + 1}`;
        push(tab.network, {
          id: entryId,
          method: request.method(),
          url: request.url(),
          status: response?.status() ?? null,
          type: request.resourceType(),
          at: Date.now(),
        });
        if (response !== null) tab.bodies.set(entryId, response);
      });
    });
    page.on("requestfailed", (request: Request) => {
      push(tab.network, {
        id: `req_${tab.network.length + 1}`,
        method: request.method(),
        url: request.url(),
        status: null,
        type: request.resourceType(),
        at: Date.now(),
      });
    });
    // A dialog left unanswered blocks the page forever, and the model has no
    // way to see that it is blocked. Dismissing is the safe default: it is
    // what a page gets when nobody is watching, and a tool exists for the
    // cases where an answer is actually wanted.
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    page.on("close", () => {
      this.#tabs.delete(id);
      if (this.#active === id) this.#active = this.tabIds[0];
    });

    this.#tabs.set(id, tab);
    this.#active = id;
    return tab;
  }

  tab(tabId: string): Tab | undefined {
    return this.#tabs.get(tabId);
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.#tabs.get(tabId);
    if (tab === undefined) return;
    await tab.page.close();
    this.#tabs.delete(tabId);
    if (this.#active === tabId) this.#active = this.tabIds[0];
  }

  /**
   * Ends the browser now.
   *
   * Awaited and memoised, because two closes racing would leave the second
   * one talking to a half-shut process, and because "the browser is gone"
   * has to be true before anything acts on that claim.
   */
  async close(): Promise<void> {
    this.#closing ??= (async () => {
      const browser = this.#browser;
      this.#forget();
      if (browser !== undefined) {
        await browser.close().catch(() => undefined);
      }
    })();
    const closing = this.#closing;
    await closing;
    this.#closing = undefined;
  }

  #forget(): void {
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = undefined;
    this.#browser = undefined;
    this.#context = undefined;
    this.#channel = undefined;
    this.#tabs.clear();
    this.#active = undefined;
  }

  #touch(): void {
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      void this.close();
    }, IDLE_MS);
    // The timer must not be the reason this process stays alive. A browser
    // that has gone idle is a browser nobody is waiting for.
    this.#idle.unref?.();
  }
}

function push<T>(log: T[], entry: T): void {
  log.push(entry);
  // A page that loads a thousand assets must not become a memory leak that
  // outlives the interest anybody has in its first ten.
  if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
}

export type { Tab };
