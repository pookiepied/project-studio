import { StudioError } from "../contracts/errors.js";

/**
 * How the browser fails.
 *
 * Its own domain rather than `extend` or `tools`, and the test is the one the
 * taxonomy applies everywhere: do these need *different answers from a person*
 * than the neighbouring domains do?
 *
 * They do. "No browser is installed on this machine" is answered by installing
 * Edge — nothing about MCP, servers or settings is involved, and sending
 * someone to the extensions screen for it would waste their afternoon. "The
 * element you pointed at is not on the page" is answered by the model, on its
 * next step, and never by a person at all. Neither reads as "that server is not
 * switched on for this project", which is what `extend` means.
 *
 * These errors also travel differently from every other domain's. The browser
 * runs in its own process and answers over MCP, so a failure here becomes the
 * *text of a tool result* rather than an HTTP body — which is exactly why the
 * message matters more here than the code does, and why each kind below has a
 * default sentence written for a model to act on.
 */

export type BrowserFailure =
  /**
   * No browser could be launched. The one failure a person has to fix, and the
   * message names what was looked for, where, and what to install.
   */
  | "no_browser"
  /** The tab named does not exist, or the browser is not running. */
  | "no_tab"
  /** The element pointed at is not on the page, usually because it navigated. */
  | "no_element"
  /** The call did not say what to act on, or said something contradictory. */
  | "bad_input"
  /** The page did not reach the expected state in time. */
  | "timed_out"
  /** A mistake in our own wiring, not something anyone can act on. */
  | "internal";

const MESSAGE_BY_FAILURE: Record<BrowserFailure, string> = {
  no_browser: "No browser could be started.",
  no_tab: "That tab is not open.",
  no_element: "That element is not on the page.",
  bad_input: "That call did not say what to act on.",
  timed_out: "The page did not reach that state in time.",
  internal: "Something is wired incorrectly inside Project Studio's browser.",
};

/**
 * Which failures are worth trying again unchanged.
 *
 * A timeout may pass on a second attempt because a page finished loading. The
 * rest will not: a missing element stays missing until the page is read again,
 * and an uninstalled browser stays uninstalled. Deciding it here means no
 * caller has to know the vocabulary to answer the question.
 */
const RETRYABLE: ReadonlySet<BrowserFailure> = new Set<BrowserFailure>(["timed_out"]);

export class BrowserError extends StudioError {
  readonly domain = "browser" as const;
  declare readonly kind: BrowserFailure;

  constructor(kind: BrowserFailure, options: { message?: string } = {}) {
    super(kind, options.message ?? MESSAGE_BY_FAILURE[kind], {
      retryable: RETRYABLE.has(kind),
    });
    this.name = "BrowserError";
  }
}
