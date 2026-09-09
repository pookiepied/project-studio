import type { Locator, Page } from "playwright-core";
import { BrowserError } from "./errors.js";

/**
 * Reading a page as an outline the model can point at.
 *
 * A model cannot see pixels well enough to click reliably, and CSS selectors
 * it invents from a screenshot are wrong most of the time — a class name it
 * guessed, a structure that changed one build ago. So every readable element
 * is stamped with a number as the page is read, and the model points at the
 * number. `ref_12` means "the twelfth thing you just showed me", which cannot
 * drift, cannot be guessed wrong, and needs no knowledge of the page's
 * internals.
 *
 * The stamp is an attribute on the element rather than a remembered handle,
 * because a handle does not survive a navigation and an attribute does not
 * need to: a new read re-stamps the page, and a ref from before a navigation
 * simply is not there, which is the honest answer rather than a stale click on
 * whatever moved into its place.
 *
 * **Everything read here is a third party's words.** It is labelled as such
 * where it reaches the model, the same way the fetch tools label what they
 * return. A page can address a model, and one that says "ignore your previous
 * instructions" in an alt attribute is a page doing exactly that.
 */

/** The attribute a ref is written into. Namespaced so no real page owns it. */
export const REF_ATTRIBUTE = "data-studio-ref";

export interface SnapshotOptions {
  /** Include elements that are not interactive, for reading structure. */
  readonly all?: boolean;
  /** Cap on lines, so an enormous page cannot fill a context window. */
  readonly limit?: number;
}

/**
 * Stamps the page and returns its outline.
 *
 * Runs in the page rather than over the CDP accessibility tree, because what
 * matters here is the *element a click lands on*, and the accessibility tree
 * has nodes that are not elements and elements that are not nodes. Walking the
 * DOM and asking each element how it presents itself answers the question
 * actually being asked.
 */
export async function snapshot(page: Page, options: SnapshotOptions = {}): Promise<string> {
  const limit = options.limit ?? 400;
  const all = options.all === true;

  return page.evaluate(
    ([attribute, includeAll, max]) => {
      const INTERACTIVE = new Set([
        "a",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "option",
      ]);
      const STRUCTURAL = new Set([
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "label",
        "li",
        "td",
        "th",
        "p",
        "img",
        "form",
        "nav",
        "main",
        "article",
        "section",
      ]);

      // Cleared first, so a ref never means two different things across two
      // reads of the same page. A stale number that silently rebinds is worse
      // than one that is simply gone.
      for (const stamped of Array.from(document.querySelectorAll(`[${attribute}]`))) {
        stamped.removeAttribute(attribute);
      }

      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      };

      const role = (element: Element): string => {
        const explicit = element.getAttribute("role");
        if (explicit !== null && explicit !== "") return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "input") {
          return (element as HTMLInputElement).type || "textbox";
        }
        return tag;
      };

      const label = (element: Element): string => {
        const aria = element.getAttribute("aria-label");
        if (aria !== null && aria.trim() !== "") return aria.trim();
        const input = element as HTMLInputElement;
        if (typeof input.placeholder === "string" && input.placeholder.trim() !== "") {
          return input.placeholder.trim();
        }
        if (element.tagName.toLowerCase() === "img") {
          const alt = element.getAttribute("alt");
          if (alt !== null && alt.trim() !== "") return alt.trim();
        }
        const text = (element as HTMLElement).innerText ?? element.textContent ?? "";
        return text.replace(/\s+/g, " ").trim().slice(0, 120);
      };

      const lines: string[] = [];
      let counter = 0;
      const walk = (element: Element, depth: number): void => {
        if (lines.length >= max) return;
        const tag = element.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") return;

        const interactive = INTERACTIVE.has(tag) || element.hasAttribute("onclick");
        const wanted = interactive || (includeAll && STRUCTURAL.has(tag));

        if (wanted && visible(element)) {
          counter += 1;
          element.setAttribute(attribute, String(counter));
          const parts = [`${"  ".repeat(Math.min(depth, 8))}${role(element)}`];
          const name = label(element);
          if (name !== "") parts.push(`"${name}"`);
          const href = element.getAttribute("href");
          if (href !== null && href !== "") parts.push(`href=${href}`);
          const value = (element as HTMLInputElement).value;
          if (typeof value === "string" && value !== "") parts.push(`value="${value.slice(0, 60)}"`);
          if ((element as HTMLInputElement).disabled === true) parts.push("disabled");
          if ((element as HTMLInputElement).checked === true) parts.push("checked");
          parts.push(`[ref_${counter}]`);
          lines.push(parts.join(" "));
        }

        for (const child of Array.from(element.children)) walk(child, depth + 1);
      };

      walk(document.body, 0);
      if (lines.length >= max) lines.push(`… more elements than ${String(max)}, not listed.`);
      return lines.join("\n");
    },
    [REF_ATTRIBUTE, all, limit] as const,
  );
}

/**
 * Turns `ref_12` into something clickable, or says why it cannot.
 *
 * A ref that is not on the page is almost always a ref from before a
 * navigation, and that is worth saying rather than letting a click time out
 * against nothing — a timeout reads as "the page is slow", which sends the
 * model somewhere unhelpful.
 */
export function byRef(page: Page, ref: string): Locator {
  const match = /^ref_(\d+)$/.exec(ref.trim());
  if (match === null) {
    throw new BrowserError("bad_input", {
      message: `"${ref}" is not an element reference. A reference looks like ref_12 and comes from reading the page.`,
    });
  }
  return page.locator(`[${REF_ATTRIBUTE}="${match[1] as string}"]`);
}

/**
 * The one place a target becomes a locator.
 *
 * Both spellings are accepted because both are genuinely useful: a ref is
 * reliable and comes from a read, and a CSS selector is what a model already
 * has when it wrote the page itself and knows exactly what it put there.
 */
export function locate(page: Page, target: { ref?: string; selector?: string }): Locator {
  if (target.ref !== undefined && target.ref !== "") return byRef(page, target.ref);
  if (target.selector !== undefined && target.selector !== "") {
    return page.locator(target.selector);
  }
  throw new BrowserError("bad_input", {
    message: "Give either a ref from reading the page, or a CSS selector.",
  });
}
