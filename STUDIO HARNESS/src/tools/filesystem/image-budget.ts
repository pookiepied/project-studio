/**
 * What a conversation may spend on pictures, and why each number is that number.
 *
 * Every limit here is derived from a documented provider limit rather than
 * chosen for feel, because the failure they prevent is not "the context is
 * getting full" - it is the request being rejected on the wire, after the
 * person has already waited for it.
 *
 * The four facts these are built on, from Anthropic's vision documentation
 * (the strictest surface Studio talks to; other providers are looser, and a
 * limit that holds here holds there):
 *
 *   - 10 MB per image, measured on the base64 payload, on the API directly.
 *     5 MB on Bedrock and Vertex. Base64 inflates bytes by four thirds, so a
 *     raw file of R bytes arrives as about 1.33 R.
 *   - 32 MB for the whole request, on standard endpoints.
 *   - 100 images per request on a 200k-context model, 600 on the rest.
 *   - Past 20 images in one request, a stricter per-image dimension limit
 *     applies to every image in it, and images over it are rejected outright.
 *
 * The second and fourth are the ones that actually bite, and both are about
 * the request as a whole rather than any single picture. That matters here
 * because a conversation resends its entire history on every turn: the tenth
 * screenshot is not the tenth image in the request, it is the tenth image
 * being sent for the tenth time, alongside the previous nine. So the budget is
 * cumulative over a conversation, not per call.
 *
 * ---- What is deliberately not here ----------------------------------------
 *
 * No downscaling. It was considered and rejected on the evidence: providers
 * already downscale anything above their working resolution before tokenising
 * it, and the token cost is capped by that tier regardless of what arrives.
 * A 4K screenshot and a 1456px one cost the same 1560 visual tokens on a
 * standard-tier model. Resizing here would buy upload bandwidth, cost an
 * image decoder as a native dependency, and risk making small text unreadable
 * - which is usually the entire reason a screenshot was being read. The
 * limits below exist to keep requests legal, not to save tokens, because
 * there are no tokens to save.
 */

/** Raw bytes for one image, before base64. */
export const MAX_IMAGE_BYTES = 5_000_000;

/**
 * Images one conversation may accumulate.
 *
 * Twenty, because that is the threshold past which a stricter per-image
 * dimension limit applies to every image in the request - including the ones
 * sent on earlier turns. Crossing it does not degrade anything gently; it
 * starts rejecting pictures that were fine on the turn before.
 */
export const MAX_IMAGES_PER_CONVERSATION = 20;

/**
 * Raw bytes of image across a conversation.
 *
 * 15 MB raw is about 20 MB once base64'd, which leaves a third of the 32 MB
 * request for the transcript, the tool definitions and the system prompt. The
 * count limit above is reached first for ordinary screenshots; this one is
 * what catches a handful of very large photographs.
 */
const MAX_CONVERSATION_IMAGE_BYTES = 15_000_000;

export interface ImageSpend {
  readonly images: number;
  readonly bytes: number;
}

/** Why a picture was refused, or `null` when it fits. */
export type BudgetRefusal =
  | { readonly kind: "too-large"; readonly bytes: number }
  | { readonly kind: "too-many"; readonly spent: ImageSpend }
  | { readonly kind: "too-heavy"; readonly spent: ImageSpend }
  | null;

/**
 * The running total of what each conversation has sent.
 *
 * In memory, and deliberately so - it is a guard against building an illegal
 * request, not a record of anything. The one consequence worth stating: a
 * harness restart forgets what a conversation already carries, so a long
 * conversation resumed after a restart starts counting from zero again. The
 * request limit is still enforced by the provider in that case; the person
 * gets its error instead of ours. Persisting this would mean a second source
 * of truth about the transcript, which is worse than the gap it closes.
 */
export class ImageBudget {
  readonly #spent = new Map<string, { images: number; bytes: number }>();

  spentOn(conversationId: string): ImageSpend {
    return this.#spent.get(conversationId) ?? { images: 0, bytes: 0 };
  }

  /** Whether one more image of `bytes` fits, without recording it. */
  check(conversationId: string, bytes: number): BudgetRefusal {
    if (bytes > MAX_IMAGE_BYTES) return { kind: "too-large", bytes };
    const spent = this.spentOn(conversationId);
    if (spent.images + 1 > MAX_IMAGES_PER_CONVERSATION) {
      return { kind: "too-many", spent };
    }
    if (spent.bytes + bytes > MAX_CONVERSATION_IMAGE_BYTES) {
      return { kind: "too-heavy", spent };
    }
    return null;
  }

  /** Records an image that was actually returned to the model. */
  record(conversationId: string, bytes: number): void {
    const spent = this.spentOn(conversationId);
    this.#spent.set(conversationId, {
      images: spent.images + 1,
      bytes: spent.bytes + bytes,
    });
  }

  /** Forgets one conversation. For a deletion, and for tests. */
  forget(conversationId: string): void {
    this.#spent.delete(conversationId);
  }
}

/** Kilobytes, for a message a person reads. */
function kb(bytes: number): number {
  return Math.round(bytes / 1024);
}

/**
 * What to tell the model, which is also what to tell the person reading over
 * its shoulder. Each says the limit, what has been spent against it, and the
 * one action that would get past it - a refusal that only says "no" gets
 * retried verbatim.
 */
export function refusalMessage(path: string, refusal: NonNullable<BudgetRefusal>): string {
  if (refusal.kind === "too-large") {
    return (
      `This image is ${kb(refusal.bytes)} KB, and the limit for one image is ` +
      `${kb(MAX_IMAGE_BYTES)} KB - past that the provider refuses the request. ` +
      "Resize it, or ask the user to."
    );
  }
  if (refusal.kind === "too-many") {
    return (
      `This conversation has already taken in ${refusal.spent.images} images, which is ` +
      `the limit. Past ${MAX_IMAGES_PER_CONVERSATION} the provider applies a stricter size ` +
      `rule to every image in the request, including the earlier ones. ${path} cannot be ` +
      "added. Start a new conversation for further pictures, or describe this one instead."
    );
  }
  return (
    `This conversation is already carrying ${kb(refusal.spent.bytes)} KB of images, and the ` +
    `limit is ${kb(MAX_CONVERSATION_IMAGE_BYTES)} KB - every turn resends all of them, so ` +
    `they count together. ${path} would take it over. Start a new conversation for further ` +
    "pictures, or describe this one instead."
  );
}
