import { MediaError } from "../../contracts/media.js";
import type { ModelPricing } from "../../contracts/providers.js";
import type { ModelCapability } from "../../contracts/models.js";
import { requestDirect } from "../../net/http.js";
import { getObservability, isObservabilityInitialized } from "../../observability/index.js";
import type { CatalogSourceModel } from "./index.js";

/**
 * The contract a live media listing answers, and the machinery it shares.
 *
 * A vendor that publishes a model listing is read live - fetched on demand,
 * cached an hour, empty answers not cached, every entry classified into
 * Studio's slots from the vendor's own metadata. That was written once, for
 * OpenRouter, inside its own module; a second vendor would have copied the
 * cache, the failure mode and the classification floor, and then disagreed
 * with the first. They all share this one.
 *
 * What stays with the vendor: which URLs to read, how its pages are shaped,
 * which fields earn which slot, and how many listed entries no Studio slot
 * answers - counted, not hidden, so the next slot is decided from a number
 * rather than a feeling. Everything a second vendor would have to copy
 * instead lives here:
 *
 * - the hour's cache, keyed by the connection's own origin, because two
 *   connections to two deployments of one vendor are two catalogues;
 * - the empty-not-cached rule: emptiness is what "offline" looks like, and
 *   the next paint should ask again rather than show nothing for an hour;
 * - the swallow: a settings screen reads this synchronously, so a listing
 *   that cannot be reached answers nothing rather than throwing into it;
 * - the one transport: a GET with a ten-second ceiling whose refusal says
 *   the vendor's name, and where the credential - when the vendor wants one
 *   - rides only in the outbound header, never into a record or a result.
 * - the classification floor: every dimension the vendor did not state is
 *   "unsupported", because a live answer is the vendor's own word, and a
 *   word that does not mention pictures means the vendor did not promise
 *   pictures. (Declared models are the opposite: their silence stays
 *   "unknown" - see `capabilityFromDeclared` in `index.ts`.)
 *
 * No pricing is read: audio, image and video are priced per second, per
 * image and per character across vendors, and there is no honest single
 * number to print - the gateway plan's decision, and the reason `pricing`
 * stays unknown. A vendor's answer may carry prices; they are dropped here
 * until a format exists to show them honestly.
 */

const LISTING_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1_000;

/** Pricing as every live listing reports it: nothing, because nothing prints it. */
export const UNKNOWN_MODEL_PRICING: ModelPricing = {
  input: "unknown",
  output: "unknown",
  cacheRead: "unknown",
  cacheWrite: "unknown",
};

/**
 * The capability a vendor's own word earns, over an all-unsupported floor.
 * Whatever the listing states stands; everything it omits it did not
 * promise, and there is no second chance to guess.
 */
export function capabilityFor(earned: Partial<ModelCapability>): ModelCapability {
  return {
    textGeneration: "unsupported",
    streaming: "unknown",
    reasoning: "unsupported",
    toolCalling: "unsupported",
    vision: "unknown",
    embeddings: "unsupported",
    reranking: "unsupported",
    imageGeneration: "unsupported",
    imageEditing: "unsupported",
    videoGeneration: "unsupported",
    speechGeneration: "unsupported",
    transcription: "unsupported",
    documentReading: "unsupported",
    webSearch: "unsupported",
    webFetch: "unsupported",
    contextWindow: "unknown",
    maxOutputTokens: "unknown",
    ...earned,
  };
}

/** One answer of the vendor's, read as its JSON text. */
export type MediaListingFetch = (url: string, headers: Record<string, string>) => Promise<string>;

/** The transport under every listing: one GET, ten seconds, the vendor's name on a refusal. */
function listingFetch(vendor: string): MediaListingFetch {
  return async (url, headers) => {
    const answered = await requestDirect({
      url,
      author: "user",
      method: "GET",
      headers: { accept: "application/json", ...headers },
      timeoutMs: LISTING_TIMEOUT_MS,
    });
    if (answered.status >= 400) {
      throw new MediaError("provider-refused", `${vendor} answered ${String(answered.status)} to the listing.`);
    }
    return answered.body;
  };
}

/** What one read of the vendor's listing answers. */
interface MediaListingAnswer {
  readonly models: readonly CatalogSourceModel[];
  /**
   * How many entries the vendor listed that no Studio slot answers. They are
   * counted here rather than listed, because a model in the picker that
   * nothing invokes is the placeholder problem; the count is what the next
   * slot's decision reads.
   */
  readonly dropped: number;
}

interface MediaListingReadContext {
  /** The base without its trailing slashes: where the vendor's answers live. */
  readonly origin: string;
  /** The connection's credential, carried for the outbound header alone. */
  readonly credential: string | undefined;
  /** The transport. Production uses `listingFetch(vendor)`; tests bring their own. */
  readonly fetch: (url: string, headers: Record<string, string>) => Promise<string>;
}

export interface MediaListingOptions {
  /** The vendor's own name, spelled as a refusal would. */
  readonly vendor: string;
  /** The whole listing, read once. Throwing is allowed; the answer becomes nothing, uncached. */
  readonly read: (context: MediaListingReadContext) => Promise<MediaListingAnswer>;
}

/** What a test (or a rushed caller) may substitute for one read. */
interface MediaListingInvocation {
  readonly fetch?: MediaListingFetch;
  readonly now?: () => number;
}

export interface MediaListing {
  /**
   * The vendor's models at this base, classified into Studio's slots.
   * Never throws: an unreachable vendor answers nothing, uncached.
   */
  models(
    baseUrl: string,
    credential: string | undefined,
    invocation?: MediaListingInvocation,
  ): Promise<readonly CatalogSourceModel[]>;
  /** Forgets the cache. For tests; production reads fresh once an hour. */
  forget(): void;
}

/**
 * Records what one read of the listing kept and dropped, once per read -
 * a cache hit replays no numbers, and a read that threw answered nothing,
 * so there are no numbers to record. The dropped count is the whole point
 * of the second decision: the next slot (image upscaling is the obvious
 * first) is chosen from this number rather than from a feeling, and a
 * number nobody wrote down is a feeling. Zero is logged too, because "we
 * dropped nothing" is also a fact about the vendor, and the observation
 * before observability initializes (a harness still coming up) is simply
 * lost - nothing reads a catalogue before the webview can ask for one.
 */
function logListingRead(
  vendor: string,
  origin: string,
  answer: MediaListingAnswer,
): void {
  if (!isObservabilityInitialized()) return;
  getObservability().logger.info(
    `${vendor} answered its listing with ${String(answer.models.length)} models; ${String(answer.dropped)} it did not classify`,
    { vendor, origin, kept: answer.models.length, dropped: answer.dropped },
  );
}

export function createMediaListing(options: MediaListingOptions): MediaListing {
  const { vendor } = options;
  const answerFor = listingFetch(vendor);
  const cache = new Map<string, { readonly at: number; readonly models: readonly CatalogSourceModel[] }>();

  return {
    async models(baseUrl, credential, invocation) {
      const now = invocation?.now ?? (() => Date.now());
      const origin = baseUrl.replace(/\/+$/, "");
      // What a key may see is the key's own: ElevenLabs, Google and OpenAI
      // answer 401/403 to a keyless read, and a keyless read would be
      // nobody's catalogue. Two connections to one origin with two keys are
      // two answers, so the credential joins the origin in the key - it
      // lives in this process's memory only, which is where the credential
      // store's secret already lives, and never travels into any record,
      // log line, or result.
      const key = `${origin}\u0000${credential ?? ""}`;
      const cached = cache.get(key);
      if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) return cached.models;

      const fetch = invocation?.fetch ?? answerFor;
      // The read may throw - a refusal, a dead transport. Either way the
      // answer is "nothing, and ask again next paint": the caller is a
      // settings screen, which must not wear the failure.
      const answer = await options.read({ origin, credential, fetch }).catch(() => undefined);
      if (answer === undefined) return [];
      logListingRead(vendor, origin, answer);
      if (answer.models.length === 0) return [];
      cache.set(key, { at: now(), models: answer.models });
      return answer.models;
    },

    forget(): void {
      cache.clear();
    },
  };
}

/** Reads the answer as JSON when it is, else nothing. */
export function parseListingAnswer(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The entries of an OpenAI-shaped listing: `{ data: [...] }`, the envelope
 * OpenAI's own answers use and OpenRouter's repeats. A vendor with another
 * envelope parses its own - ElevenLabs answers a bare array, Google nests
 * under `models` - and two vendors sharing one is why this is here and not
 * copied second.
 */
export function dataEntries(json: string): readonly Record<string, unknown>[] {
  const parsed = parseListingAnswer(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) return [];
  return parsed.data.filter(isRecord);
}
