import type { Context, Message } from "@earendil-works/pi-ai";

import {
  MANY_PICTURES_SIDE_PX,
  MANY_PICTURES_THRESHOLD,
  PICTURE_TOKENS,
  REQUEST_MAX_PICTURES,
  REQUEST_PICTURE_BASE64_CHARS,
  REQUEST_PICTURE_CONTEXT_SHARE,
  REQUEST_PICTURE_CUT_STEP,
} from "../../contracts/media-limits.js";
import { imageDimensions } from "../../documents/image-dimensions.js";

/**
 * The pictures one model request carries: the newest ones, within limits
 * every provider Studio serves accepts. The numbers, their sources and the
 * decisions behind them are in `documentation/architecture/media-limits.md`.
 *
 * ---- Why the request, not the tool ----------------------------------------
 *
 * A conversation resends its whole history every turn, so a computer-use run
 * that took thirty screenshots sends thirty pictures on the thirty-first
 * request, and providers refuse before long: Anthropic past 32 MB, or past
 * twenty pictures when any of them is over 2000 px; some OpenRouter routes at
 * a few dozen pictures. Screenshots arrive through MCP and no per-tool count
 * can know what the history already holds. The request is the one place that
 * sees every picture from every source.
 *
 * ---- The rule ---------------------------------------------------------------
 *
 * 1. Always sent: the pictures on the latest user message (what the person
 *    just attached) and the newest picture (what the model was just shown).
 * 2. Every other picture, newest first, while the request stays inside the
 *    count (`REQUEST_MAX_PICTURES`, lowered so pictures take at most a share of
 *    the model's context) and the base64 total. Once one misses, every older
 *    one does too: a gap would show the model a stale screen as current.
 * 3. Past `MANY_PICTURES_THRESHOLD` pictures, every picture in the request must
 *    be at most `MANY_PICTURES_SIDE_PX` on each side (Anthropic refuses the
 *    whole request otherwise). When one is larger - or its size cannot be read
 *    from its header - the request keeps to the threshold instead.
 * 4. The cut moves in steps, so the start of the request, which providers
 *    cache, changes once per step of new pictures, never every turn.
 * 5. A left-out picture becomes one line of text saying how to get it back.
 *    The transcript is untouched: this is a projection of one request,
 *    recomputed every turn. A request inside the window is returned as is.
 */
export interface ImageWindow {
  /** Most pictures one request carries. */
  readonly maxImages: number;
  /** Most base64 characters of picture one request carries. */
  readonly maxBase64Chars: number;
  /** Pictures are left out in multiples of this, so the cut stays put across turns. */
  readonly step: number;
}

export const DEFAULT_IMAGE_WINDOW: ImageWindow = {
  maxImages: REQUEST_MAX_PICTURES,
  maxBase64Chars: REQUEST_PICTURE_BASE64_CHARS,
  step: REQUEST_PICTURE_CUT_STEP,
};

/** The window for a model with this context window; 0 or less means unknown. */
export function imageWindowFor(contextWindow: number): ImageWindow {
  if (!(contextWindow > 0)) return DEFAULT_IMAGE_WINDOW;
  const byContext = Math.floor((contextWindow * REQUEST_PICTURE_CONTEXT_SHARE) / PICTURE_TOKENS);
  return { ...DEFAULT_IMAGE_WINDOW, maxImages: Math.max(1, Math.min(REQUEST_MAX_PICTURES, byContext)) };
}

export const OMITTED_IMAGE_TEXT =
  "[An earlier picture was left out of this request to stay inside the provider's image limits. " +
  "Take a new screenshot, or read the file again, if you need to see it.]";

export interface WindowedContext {
  readonly context: Context;
  /** Pictures replaced by the omission text; 0 when the request was inside the window. */
  readonly omitted: number;
  readonly kept: number;
}

/** Enough base64 to reach any of the four formats' size fields, JPEG's after its metadata. */
const HEADER_BASE64_CHARS = 174_764;

interface Picture {
  readonly messageIndex: number;
  readonly blockIndex: number;
  readonly chars: number;
  readonly guarded: boolean;
  /** Within the many-pictures side limit; false when larger or unreadable. */
  readonly modest: boolean;
}

type Block = { readonly type: string; readonly data?: unknown };

function isImage(block: unknown): block is Block & { readonly data: string } {
  return typeof block === "object" && block !== null && (block as Block).type === "image" && typeof (block as Block).data === "string";
}

function blocksOf(message: Message): readonly unknown[] | undefined {
  const content = (message as { readonly content?: unknown }).content;
  return Array.isArray(content) ? content : undefined;
}

function isModest(data: string): boolean {
  const size = imageDimensions(Buffer.from(data.slice(0, HEADER_BASE64_CHARS), "base64"));
  return size !== undefined && size.width <= MANY_PICTURES_SIDE_PX && size.height <= MANY_PICTURES_SIDE_PX;
}

/** Every picture, newest first. */
function picturesOf(context: Context): Picture[] {
  let latestUser = -1;
  for (let index = context.messages.length - 1; index >= 0; index -= 1) {
    if (context.messages[index]?.role === "user") {
      latestUser = index;
      break;
    }
  }
  const pictures: Picture[] = [];
  for (let messageIndex = context.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = context.messages[messageIndex];
    const blocks = message === undefined ? undefined : blocksOf(message);
    if (blocks === undefined) continue;
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (!isImage(block)) continue;
      pictures.push({
        messageIndex,
        blockIndex,
        chars: block.data.length,
        guarded: messageIndex === latestUser || pictures.length === 0,
        modest: isModest(block.data),
      });
    }
  }
  return pictures;
}

export function windowImages(context: Context, window: ImageWindow = DEFAULT_IMAGE_WINDOW): WindowedContext {
  const pictures = picturesOf(context);
  const guarded = pictures.filter((picture) => picture.guarded);
  const others = pictures.filter((picture) => !picture.guarded);

  // The newest run of the others that fits beside what is always sent.
  let count = guarded.length;
  let chars = guarded.reduce((sum, picture) => sum + picture.chars, 0);
  let fits = 0;
  for (const picture of others) {
    if (count >= window.maxImages || chars + picture.chars > window.maxBase64Chars) break;
    count += 1;
    chars += picture.chars;
    fits += 1;
  }
  // Many pictures with any large one among them: keep to the threshold.
  const kept = [...guarded, ...others.slice(0, fits)];
  if (kept.length > MANY_PICTURES_THRESHOLD && kept.some((picture) => !picture.modest)) {
    fits = Math.max(0, Math.min(fits, MANY_PICTURES_THRESHOLD - guarded.length));
  }
  if (fits === others.length) return { context, omitted: 0, kept: pictures.length };

  // In steps, so the same older pictures stay out for several turns.
  const step = Math.max(1, Math.min(window.step, Math.floor(window.maxImages / 2)));
  const omitted = Math.min(others.length, Math.ceil((others.length - fits) / step) * step);
  const dropped = new Map<number, Set<number>>();
  for (const picture of others.slice(others.length - omitted)) {
    const set = dropped.get(picture.messageIndex) ?? new Set<number>();
    set.add(picture.blockIndex);
    dropped.set(picture.messageIndex, set);
  }
  const messages = context.messages.map((message, messageIndex) => {
    const drop = dropped.get(messageIndex);
    const blocks = blocksOf(message);
    if (drop === undefined || blocks === undefined) return message;
    return {
      ...message,
      content: blocks.map((block, blockIndex) => (drop.has(blockIndex) ? { type: "text", text: OMITTED_IMAGE_TEXT } : block)),
    } as Message;
  });
  return { context: { ...context, messages }, omitted, kept: pictures.length - omitted };
}
