import type { Locator, Page } from "playwright-core";
import { BrowserError } from "./errors.js";

/**
 * Reading a page as an outline the model can point at.
 *
 * A model cannot see pixels well enough to click reliably, and CSS selectors
 * it invents from a screenshot are wrong most of the time — a class name it
 * guessed, a structure that changed one build ago. So every readable element
 * is stamped with a number as the page is read, and the model points at the
 * number. The server reserves a fresh range for every read so a reference
 * from an earlier read, tab, or navigation cannot bind to a new element.
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
const REF_ATTRIBUTE = "data-studio-ref";
let lastReference = 0;
const activeReferences = new WeakMap<Page, { start: number; end: number }>();

export function forgetReferences(page: Page): void {
  activeReferences.delete(page);
}

export interface SnapshotOptions {
  /** Include elements that are not interactive, for reading structure. */
  readonly all?: boolean;
  /** Cap on lines, so an enormous page cannot fill a context window. */
  readonly limit?: number;
  readonly query?: string;
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
  const limit = Math.max(1, Math.min(2_000, Math.trunc(options.limit ?? 400)));
  const all = options.all === true;
  const start = lastReference;
  lastReference += limit;

  const { outline, end } = await page.evaluate(
    ([attribute, includeAll, max, first, query]) => {
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
        const associated = Array.from(input.labels ?? [])
          .map((label) => label.innerText.trim()).filter(Boolean).join(" ");
        if (associated !== "") return associated;
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

      const primary: { element: Element; depth: number; name: string }[] = [];
      const secondary: typeof primary = [];
      let matched = 0;
      let counter = first;
      const walk = (element: Element, depth: number): void => {
        // Cleared as it is reached, so a ref never means two different things
        // across two reads of the same page. A stale number that silently
        // rebinds is worse than one that is simply gone. Done here rather than
        // with one `querySelectorAll` up front because that query stops at a
        // shadow boundary and this walk does not.
        element.removeAttribute(attribute);
        const tag = element.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") return;

        // A rich-text editor is a div that takes typing; without this line it
        // is invisible to a read and the model has nothing to type into. The
        // attribute, not `isContentEditable`: the property is inherited by
        // every paragraph inside the editor, and stamping each of those would
        // bury the one ref that matters.
        const editableAttribute = element.getAttribute("contenteditable");
        const editable = editableAttribute !== null && editableAttribute !== "false";
        const interactive = INTERACTIVE.has(tag) || editable || element.hasAttribute("onclick");
        const wanted = interactive || (includeAll && STRUCTURAL.has(tag));

        const candidates = query !== null && !interactive ? secondary : primary;
        if (wanted && candidates.length < max && visible(element)) {
          const name = label(element);
          const matches = query === null || [name, element.getAttribute("title"), (element as HTMLInputElement).placeholder]
            .some((value) => value?.toLowerCase().includes(query) === true);
          if (matches) {
            candidates.push({ element, depth, name });
            matched += 1;
          }
        }

        // `children` never enters a shadow root, so a web component's insides
        // would read as an empty box. The selector path already pierces shadow
        // DOM (Playwright's engine does by default), so without this the model
        // could click a thing it was never shown.
        const shadow = element.shadowRoot;
        if (shadow !== null) {
          for (const child of Array.from(shadow.children)) walk(child, depth + 1);
        }
        for (const child of Array.from(element.children)) walk(child, depth + 1);
      };

      walk(document.body, 0);
      // For find, prefer an actionable control over a container whose text
      // merely repeats the control's label. Ordinary reads stay in DOM order.
      const lines = [...primary, ...secondary].slice(0, max).map(({ element, depth, name }) => {
        counter += 1;
        element.setAttribute(attribute, String(counter));
        const parts = [`${"  ".repeat(Math.min(depth, 8))}${role(element)}`];
        if (name !== "") parts.push(`"${name}"`);
        const href = element.getAttribute("href");
        if (href !== null && href !== "") parts.push(`href=${href}`);
        const input = element as HTMLInputElement;
        const value = input.value;
        if (input.type !== "password" && typeof value === "string" && value !== "") parts.push(`value="${value.slice(0, 60)}"`);
        if (input.disabled === true) parts.push("disabled");
        if (input.checked === true) parts.push("checked");
        parts.push(`[ref_${counter}]`);
        return parts.join(" ");
      });
      if (matched >= max) lines.push(`… listing capped at ${String(max)} elements.`);
      return { outline: lines.join("\n"), end: counter };
    },
    [REF_ATTRIBUTE, all, limit, start, options.query?.toLowerCase() ?? null] as const,
  );
  activeReferences.set(page, { start, end });
  return outline;
}

/**
 * Turns `ref_12` into something clickable, or says why it cannot.
 *
 * A ref that is not on the page is almost always a ref from before a
 * navigation, and that is worth saying rather than letting a click time out
 * against nothing — a timeout reads as "the page is slow", which sends the
 * model somewhere unhelpful.
 */
function byRef(page: Page, ref: string): Locator {
  const match = /^ref_(\d+)$/.exec(ref.trim());
  if (match === null) {
    throw new BrowserError("bad_input", {
      message: `"${ref}" is not an element reference. A reference looks like ref_12 and comes from reading the page.`,
    });
  }
  const range = activeReferences.get(page);
  const id = Number(match[1]);
  if (range === undefined || id <= range.start || id > range.end) {
    throw new BrowserError("bad_input", { message: `"${ref}" is no longer current for this tab. Use a reference from the latest read_page or find result for this tab.` });
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
