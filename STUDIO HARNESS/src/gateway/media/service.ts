import type { CapabilityResolver } from "../connections/capability-defaults.js";
import {
  MediaError,
  type SpeechResult,
  type TranscribeResult,
} from "../../contracts/media.js";
import { openaiSpeech } from "./drivers/openai-speech.js";
import { openaiTranscribe } from "./drivers/openai-transcribe.js";
import type {
  DriverEndpoint,
  SpeechDriver,
  SpeechSlotInput,
  TranscriptionDriver,
  TranscriptionSlotInput,
} from "./drivers/types.js";
import { bindAudioSlot } from "./resolve.js";

/**
 * The one module routes and tools both read for media.
 *
 * Owns the dispatch (slot -> binding -> driver by protocol) and the ceilings
 * that are policy rather than wire mechanics - how much text one speech call
 * may carry, which protocols serve which capability. The drivers own the wire
 * mappings; `bindAudioSlot` owns the provider store; nothing here opens a
 * socket.
 *
 * The two surfaces this serves today are the app features - dictation and
 * read-aloud, where the person is the invoker. The generation tools
 * (`studio_image`, `studio_video`) will dispatch through here too when they
 * land, which is the whole reason the dispatch lives in one module: the two
 * halves cannot drift about which driver serves what.
 */

/** OpenAI's TTS ceiling for one request. Splitting text is the caller's job. */
const MAX_SPEECH_CHARS = 4096;

export interface MediaAdministration {
  transcribe(input: {
    readonly audio: Uint8Array;
    readonly mimeType: string;
    readonly modelId?: string;
  }): Promise<TranscribeResult>;
  speak(input: {
    readonly text: string;
    readonly modelId?: string;
    readonly voiceId?: string;
  }): Promise<SpeechResult>;
}

export interface MediaServiceOptions {
  readonly resolver: CapabilityResolver;
  /** Injectable for tests; production uses the OpenAI drivers. */
  readonly speechDriver?: SpeechDriver;
  readonly transcribeDriver?: TranscriptionDriver;
}

export class MediaService {
  readonly #resolver: CapabilityResolver;
  readonly #speech: SpeechDriver;
  readonly #transcribe: TranscriptionDriver;

  constructor(options: MediaServiceOptions) {
    this.#resolver = options.resolver;
    this.#speech = options.speechDriver ?? openaiSpeech;
    this.#transcribe = options.transcribeDriver ?? openaiTranscribe;
  }

  async transcribe(input: {
    readonly audio: Uint8Array;
    readonly mimeType: string;
    readonly modelId?: string;
  }): Promise<TranscribeResult> {
    if (input.mimeType === "" || !input.mimeType.startsWith("audio/")) {
      throw new MediaError("provider-refused", "Only audio can be transcribed.");
    }
    const binding = await bindAudioSlot(this.#resolver, "transcription", input.modelId);
    return this.#transcribe(
      {
        audio: input.audio,
        mimeType: input.mimeType,
        modelId: binding.modelId,
      } satisfies TranscriptionSlotInput,
      binding satisfies DriverEndpoint,
    );
  }

  async speak(input: {
    readonly text: string;
    readonly modelId?: string;
    readonly voiceId?: string;
  }): Promise<SpeechResult> {
    if (input.text.length > MAX_SPEECH_CHARS) {
      throw new MediaError(
        "provider-refused",
        `Read-aloud takes up to ${MAX_SPEECH_CHARS} characters per request.`,
      );
    }
    const binding = await bindAudioSlot(this.#resolver, "speechGeneration", input.modelId);
    return this.#speech(
      {
        text: input.text,
        modelId: binding.modelId,
        ...(input.voiceId === undefined ? {} : { voiceId: input.voiceId }),
      } satisfies SpeechSlotInput,
      binding satisfies DriverEndpoint,
    );
  }
}
