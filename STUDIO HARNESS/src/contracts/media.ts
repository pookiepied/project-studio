import * as v from "valibot";

import { StudioError } from "./errors.js";

/**
 * The media surface's wire contract: the request and result shapes of the
 * speech and transcription routes, and the subsystem's failure class.
 *
 * This is the app-feature half of media - dictation and read-aloud, where the
 * PERSON is the invoker - so it sits beside the other route contracts rather
 * than beside the tools. Generated images and video (the model-invoked half)
 * will name their own contracts beside the tools that produce them; the two
 * halves share nothing but the capability store they resolve through.
 */

/**
 * A media capability could not be performed. Distinct kinds:
 *
 * - `slot-unset`: no model is connected for the capability. Fixed in Settings.
 * - `slot-protocol`: the connected model speaks a protocol media does not
 *   drive yet. Fixed by connecting a provider that does.
 * - `audio-too-large`: the recording passed the provider's own ceiling before
 *   the wire was touched.
 * - `provider-refused`: the provider answered, and the answer was no. The
 *   provider's own sentence travels; keys never do.
 */
export type MediaFailureKind =
  | "slot-unset"
  | "slot-protocol"
  | "audio-too-large"
  | "provider-refused";

export class MediaError extends StudioError {
  readonly domain = "media" as const;

  constructor(kind: MediaFailureKind, message: string, options: { retryable?: boolean } = {}) {
    super(kind, message, { retryable: options.retryable ?? kind !== "slot-unset" });
    this.name = "MediaError";
  }
}

/** Binary audio riding a JSON route: base64, the same shape attachments use. */
export const transcribeRequestSchema = v.object({
  audio: v.pipe(v.string(), v.minLength(1)),
  mimeType: v.pipe(v.string(), v.minLength(1)),
  /** Optional model override; absent means the slot's own model stands. */
  modelId: v.optional(v.pipe(v.string(), v.minLength(1))),
});

export const speechRequestSchema = v.object({
  text: v.pipe(v.string(), v.minLength(1)),
  modelId: v.optional(v.pipe(v.string(), v.minLength(1))),
  voiceId: v.optional(v.pipe(v.string(), v.minLength(1))),
});

export interface TranscribeResult {
  readonly text: string;
}

export interface SpeechResult {
  /** The audio, base64 - the same encoding the attachments path speaks. */
  readonly audio: string;
  readonly mimeType: string;
}
