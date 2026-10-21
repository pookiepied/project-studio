import type { Context, Message } from "@earendil-works/pi-ai";

/**
 * The pictures one model request carries: the newest ones, within limits every
 * provider Studio serves accepts.
 *
 * ---- Why the request, not the tool ----------------------------------------
 *
 * A conversation resends its whole history every turn, so a computer-use run
 * that took thirty screenshots sends thirty pictures on the thirty-first
 * request - and the providers refuse before that: Anthropic past 32 MB per
 * request (about two dozen full-screen screenshots once base64'd), and past
 * twenty pictures a stricter size rule for each of them; several OpenRouter
 * routes cap the count lower still. The run then fails mid-task around the
 * 30th picture, which is the failure this exists for. `ImageBudget` counts
 * what `read` and the media tools add; screenshots arrive through MCP and
 * never passed it, and no per-tool count can know what the history already
 * holds. The request is the one place that sees all of it.
 *
 * ---- What it does ---------------------------------------------------------
 *
 * Walks the messages newest first and keeps pictures while both the count and
 * the base64 total stay inside the window; every older picture becomes a
 * short text saying it was left out and how to get it back. The transcript is
 * untouched - this is a projection of one request, recomputed on every turn,
 * so nothing is lost and the newest view of the screen always rides. A
 * request already inside the window is returned as the same object.
 *
 * The cut moves in steps, not one picture at a time. Providers cache a
 * request's unchanged beginning; a cut that advanced with every new
 * screenshot would change an early message on every turn and lose that
 * cache each time. Stepping keeps the same pictures out for several turns.
 */
export interface ImageWindow {
  /** Most pictures one request carries. */
  readonly maxImages: number;
  /** Most base64 characters of picture one request carries. */
  readonly maxBase64Chars: number;
  /** Pictures are left out in multiples of this, so the cut stays put across turns. */
  readonly step: number;
}

/**
 * Twenty: past it Anthropic applies a stricter per-picture size rule to every
 * picture in the request. 20 MB of base64 leaves a third of the strictest
 * 32 MB request for the transcript, tools and system prompt; screenshots are
 * capped under 1 MB each, so the count is what normally binds.
 */
export const DEFAULT_IMAGE_WINDOW: ImageWindow = { maxImages: 20, maxBase64Chars: 20_000_000, step: 10 };

export const OMITTED_IMAGE_TEXT =
  "[An earlier picture was left out of this request to stay inside the provider's image limits. " +
  "Take a new screenshot, or read the file again, if you need to see it.]";

export interface WindowedContext {
  readonly context: Context;
  /** Pictures replaced by the omission text; 0 when the request was inside the window. */
  readonly omitted: number;
  readonly kept: number;
}

type Block = { readonly type: string; readonly data?: unknown };

function isImage(block: unknown): block is Block & { readonly data: string } {
  return typeof block === "object" && block !== null && (block as Block).type === "image" && typeof (block as Block).data === "string";
}

function blocksOf(message: Message): readonly unknown[] | undefined {
  const content = (message as { readonly content?: unknown }).content;
  return Array.isArray(content) ? content : undefined;
}

export function windowImages(context: Context, window: ImageWindow = DEFAULT_IMAGE_WINDOW): WindowedContext {
  // Every picture, newest first, as [message index, block index, base64 length].
  const pictures: (readonly [number, number, number])[] = [];
  for (let messageIndex = context.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = context.messages[messageIndex];
    const blocks = message === undefined ? undefined : blocksOf(message);
    if (blocks === undefined) continue;
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (isImage(block)) pictures.push([messageIndex, blockIndex, block.data.length]);
    }
  }
  // The newest run that fits both limits. Once one picture misses, every
  // older one does too: a gap would show the model a stale screen as current.
  let fits = 0;
  let chars = 0;
  for (const [, , length] of pictures) {
    if (fits >= window.maxImages || chars + length > window.maxBase64Chars) break;
    fits += 1;
    chars += length;
  }
  if (fits === pictures.length) return { context, omitted: 0, kept: fits };
  // The newest picture always rides: it is what the model was just shown.
  const step = Math.max(1, window.step);
  const omitted = Math.min(pictures.length - 1, Math.ceil((pictures.length - fits) / step) * step);
  const kept = pictures.length - omitted;
  const dropped = new Map<number, Set<number>>();
  for (const [messageIndex, blockIndex] of pictures.slice(kept)) {
    const set = dropped.get(messageIndex) ?? new Set<number>();
    set.add(blockIndex);
    dropped.set(messageIndex, set);
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
  return { context: { ...context, messages }, omitted, kept };
}
