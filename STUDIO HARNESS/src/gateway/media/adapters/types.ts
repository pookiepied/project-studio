import type { MediaProtocol } from "../../../contracts/providers.js";
import type { DriverEndpoint, SpeechDriver, TranscriptionDriver } from "../drivers/types.js";

/**
 * The adapter every media vendor implements, and the two shapes a generation
 * can take.
 *
 * There is no "OpenAI-compatible" for images, video or audio: every vendor
 * has its own request shape, its own result shape and its own idea of
 * whether a call returns or is polled. What the vendors differ in
 * structurally, though, is only how you wait - and that is the axis the
 * contract already names (`invocationShapeSchema`: `sync`, `poll`, `stream`).
 * So an adapter absorbs the wire and answers in one of two ways: a promise
 * of bytes, for a call that returns; or a polled generation, for a job the
 * harness has to ask after. Nothing above the adapter knows the vendor's
 * field names, its status vocabulary, or how long its result URL lives.
 *
 * ---- Every result is bytes the harness owns --------------------------------
 *
 * Most polled vendors hand back a URL that dies: ten minutes at Black Forest
 * Labs, an hour at Replicate, a day at Wan, two at Veo. A URL is therefore
 * never a result here. The adapter downloads at the moment the vendor says
 * done - inside its own poll, while the URL is still alive - and answers
 * with the bytes. The job store writes them to the conversation's artifacts
 * directory; the transcript shows a file Studio holds, and a vendor's
 * retention policy is the adapter's private business.
 *
 * ---- Why speech and transcription are here too ----------------------------
 *
 * The two audio drivers predate this file and keep their own function
 * types. An adapter carries them as optional members so that one vendor -
 * one `serves.media` protocol - is one object with everything it can do,
 * and the service dispatches by protocol once rather than once per
 * capability. Step 5 of the gateway plan folds the OpenAI drivers in; until
 * then the service keeps its direct defaults for audio.
 */

/** Bytes with the type that says what they are. */
export interface MediaBytes {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ImageGenerationInput {
  readonly prompt: string;
  readonly modelId: string;
  /** A vendor-shaped size such as "1024x1024", passed through when the vendor takes one. */
  readonly size?: string;
  /** "16:9", "1:1" - the ratio, when the vendor takes one instead of a size. */
  readonly aspectRatio?: string;
  /** How many images to make. Vendors that make one ignore anything above it. */
  readonly count?: number;
  /**
   * Input images, for editing and reference-guided generation. Present, the
   * call is an edit and lands in the `imageEditing` slot; absent, it is a
   * generation.
   */
  readonly inputImages?: readonly MediaBytes[];
}

export interface VideoGenerationInput {
  readonly prompt: string;
  readonly modelId: string;
  readonly durationSeconds?: number;
  readonly aspectRatio?: string;
  /** "720p", "1080p" - as the vendor names it. */
  readonly resolution?: string;
  /** A first frame, for image-to-video. */
  readonly image?: MediaBytes;
}

/** What one poll of a running generation found. */
export type PollOutcome =
  | { readonly state: "queued" | "running"; readonly detail?: string }
  | { readonly state: "done"; readonly outputs: readonly MediaBytes[] }
  | { readonly state: "failed"; readonly message: string };

/**
 * A generation the vendor runs as a job.
 *
 * `id` is the vendor's own id, durable enough to be logged. `poll` answers
 * the current state and, when done, the bytes - already downloaded. `cancel`
 * is present when the vendor has a cancel endpoint; a Stop on a job whose
 * vendor has none simply stops asking, and the job's cost is whatever the
 * vendor charges for work nobody collects.
 */
export interface PolledGeneration {
  readonly id: string;
  poll(): Promise<PollOutcome>;
  cancel?(): Promise<void>;
}

/** A call that returned, or a job that must be asked after. */
export type Generation =
  | { readonly shape: "sync"; readonly result: Promise<readonly MediaBytes[]> }
  | { readonly shape: "poll"; readonly job: PolledGeneration };

export interface MediaAdapter {
  readonly protocol: MediaProtocol;
  readonly speak?: SpeechDriver;
  readonly transcribe?: TranscriptionDriver;
  generateImage?(input: ImageGenerationInput, endpoint: DriverEndpoint): Promise<Generation>;
  generateVideo?(input: VideoGenerationInput, endpoint: DriverEndpoint): Promise<Generation>;
}

/** The adapters the service dispatches through, keyed by the wire they speak. */
export type MediaAdapters = ReadonlyMap<MediaProtocol, MediaAdapter>;
