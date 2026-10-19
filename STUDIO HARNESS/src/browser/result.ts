import type { Page } from "playwright-core";

/**
 * What a browser tool answers with, and why every answer has the same spine.
 *
 * Two things travel with every single result, acting or reading.
 *
 * **Where the page is.** A model that clicked a link and does not know where
 * it landed will take a screenshot to find out, which costs more than the two
 * lines this puts in every result. A redirect, a login wall, a 404 — all of
 * them are one line here and an expensive round trip otherwise.
 *
 * **A frame, after anything that acted.** ADR 0049 §7: the artifact in the
 * transcript is a report of a browser, and it has nothing to report unless the
 * acting call carries a picture. MCP offers no side channel — a tool result
 * answers a call, it is not a feed — so the frame rides in the result or it
 * does not exist.
 *
 * The frame is deliberately small. It is there to answer "does this look
 * right", which a 960-pixel JPEG answers as well as a full-resolution PNG and
 * for a fraction of what it costs to carry. A tool exists for the times a real
 * screenshot is the point.
 */

export interface Content {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface ToolAnswer {
  readonly content: readonly Content[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

/** The width a frame is scaled to before it is sent. */
const FRAME_QUALITY = 45;

export function text(body: string): Content {
  return { type: "text", text: body };
}

export function answer(body: string): ToolAnswer {
  return { content: [text(body)] };
}

export function failure(body: string): ToolAnswer {
  return { content: [text(body)], isError: true };
}

/** Where the page is now, in the two lines every result carries. */
export async function place(page: Page, tabId: string): Promise<string> {
  const [url, title] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => ""),
  ]);
  return `Tab: ${tabId}\nURL: ${url}\nTitle: ${title}`;
}

/**
 * A picture of the page, small enough to send with every acting call.
 *
 * Failure here is deliberately swallowed into `undefined`. A screenshot that
 * could not be taken — a page mid-navigation, a tab that closed under us — is
 * not a reason to fail the click that worked, and reporting it as one would
 * turn a successful action into an error the model then tries to undo.
 */
async function frame(page: Page): Promise<Content | undefined> {
  try {
    const shot = await page.screenshot({
      type: "jpeg",
      quality: FRAME_QUALITY,
      scale: "css",
      timeout: 5000,
    });
    return {
      type: "image",
      data: shot.toString("base64"),
      mimeType: "image/jpeg",
    };
  } catch {
    return undefined;
  }
}

/**
 * The ordinary answer from a tool that did something: what happened, where
 * the page is now, and what it looks like.
 */
export async function acted(page: Page, tabId: string, said: string): Promise<ToolAnswer> {
  const picture = await frame(page);
  const body = [text(`${said}\n\n${await place(page, tabId)}`)];
  return { content: picture === undefined ? body : [...body, picture] };
}

/** The ordinary answer from a tool that only read: no frame, just the words. */
export async function read(page: Page, tabId: string, body: string): Promise<ToolAnswer> {
  return answer(`${await place(page, tabId)}\n\n${body}`);
}

