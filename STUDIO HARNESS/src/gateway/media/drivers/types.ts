import type { SpeechResult, TranscribeResult } from "../../../contracts/media.js";

/**
 * The result types of the media drivers - one per capability, no god-interface.
 *
 * A driver is a function from a resolved slot to a result. It receives the
 * transport it speaks through as a parameter, which is what keeps it a pure
 * wire mapping: the production transport is `requestDirect`/`requestBinary`,
 * and the tests hand it a fake, so no driver ever opens a socket in a suite.
 */
export interface SpeechSlotInput {
  /** The text to speak. Length ceilings belong to the service, not here. */
  readonly text: string;
  readonly modelId: string;
  /** Voice the connection names; absent means the provider's default. */
  readonly voiceId?: string;
}

export interface TranscriptionSlotInput {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly modelId: string;
}

/** What a driver needs from the slot it was bound to, and how it speaks. */
export interface DriverEndpoint {
  readonly baseUrl: string;
  readonly credential: string | undefined;
  readonly timeoutMs?: number;
}

export type SpeechDriver = (
  input: SpeechSlotInput,
  endpoint: DriverEndpoint,
) => Promise<SpeechResult>;

export type TranscriptionDriver = (
  input: TranscriptionSlotInput,
  endpoint: DriverEndpoint,
) => Promise<TranscribeResult>;
