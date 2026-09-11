import type { CapabilitySlot } from "../../contracts/providers.js";
import type { CapabilityResolver } from "../connections/capability-defaults.js";
import {
  MediaError,
  type SpeechResult,
  type TranscribeResult,
} from "../../contracts/media.js";
import { builtinMediaAdapters } from "./adapters/index.js";
import type {
  ImageGenerationInput,
  MediaAdapter,
  MediaAdapters,
  VideoGenerationInput,
} from "./adapters/types.js";
import { MediaJobs, type MediaJobStatus } from "./jobs.js";
import type {
  DriverEndpoint,
  SpeechDriver,
  SpeechSlotInput,
  TranscriptionDriver,
  TranscriptionSlotInput,
} from "./drivers/types.js";
import { bindAudioSlot, bindGenerationSlot, type GenerationSlot } from "./resolve.js";

/**
 * The one module routes and tools both read for media.
 *
 * Owns the dispatch (slot -> binding -> driver by protocol) and the ceilings
 * that are policy rather than wire mechanics - how much text one speech call
 * may carry, which protocols serve which capability. The drivers own the wire
 * mappings; `bindAudioSlot` owns the provider store; nothing here opens a
 * socket.
 *
 * Two kinds of surface come through here. The app features - dictation and
 * read-aloud, where the person is the invoker - and the generation tools
 * (`studio_image`, `studio_video`, where the model is the invoker) both
 * dispatch to an adapter by the media wire the slot's connection speaks;
 * every generation becomes a job in `MediaJobs`, sync or polled alike. Both
 * halves resolve through the one capability seam, which is the whole reason
 * the dispatch lives in one module: they cannot drift about which vendor
 * serves what.
 *
 * A slot bound to a wire no adapter speaks, or to an adapter without that
 * capability, fails as `slot-protocol` in a sentence that says so.
 */

/** OpenAI's TTS ceiling for one request. Splitting text is the caller's job. */
const MAX_SPEECH_CHARS = 4096;

/** The slot in the words a person reads in a refusal. */
const SLOT_WORDS: Partial<Record<CapabilitySlot, string>> = {
  speechGeneration: "read-aloud",
  transcription: "dictation",
  imageGeneration: "image",
  imageEditing: "image editing",
  videoGeneration: "video",
};

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
  /**
   * The generation jobs of one conversation, and a Stop for one of them.
   * Optional: a harness built without a job registry - the tests' minimal
   * one - has no generations to list.
   */
  listJobs?(conversationId: string): readonly MediaJobStatus[];
  stopJob?(conversationId: string, id: string): boolean;
}

export interface MediaServiceOptions {
  readonly resolver: CapabilityResolver;
  /**
   * Injectable for tests: stand in for every adapter's speech or
   * transcription, whatever wire the slot binds to.
   */
  readonly speechDriver?: SpeechDriver;
  readonly transcribeDriver?: TranscriptionDriver;
  /** The vendors' adapters, by the media wire each speaks. The shipped set unless given. */
  readonly adapters?: MediaAdapters;
  /** The job registry generations run in. Required for the generation methods. */
  readonly jobs?: MediaJobs;
}

export interface GenerateOptions {
  readonly conversationId: string;
  readonly modelId?: string;
}

export class MediaService {
  readonly #resolver: CapabilityResolver;
  readonly #speech: SpeechDriver | undefined;
  readonly #transcribe: TranscriptionDriver | undefined;
  readonly #adapters: MediaAdapters;
  readonly #jobs: MediaJobs | undefined;

  constructor(options: MediaServiceOptions) {
    this.#resolver = options.resolver;
    this.#speech = options.speechDriver;
    this.#transcribe = options.transcribeDriver;
    this.#adapters = options.adapters ?? builtinMediaAdapters();
    this.#jobs = options.jobs;
  }

  /** The registry the generation jobs live in, for the tools that await them. */
  get jobs(): MediaJobs {
    return this.#requireJobs();
  }

  listJobs(conversationId: string): readonly MediaJobStatus[] {
    return this.#jobs?.list(conversationId) ?? [];
  }

  stopJob(conversationId: string, id: string): boolean {
    return this.#jobs?.stop(conversationId, id) ?? false;
  }

  /**
   * Starts an image generation or edit as a job and answers its status at
   * once. Editing is the same call with input images: the slot it resolves
   * through is `imageEditing` then, so a person can point edits at a
   * different model than generations.
   */
  async generateImage(
    input: Omit<ImageGenerationInput, "modelId">,
    options: GenerateOptions,
  ): Promise<MediaJobStatus> {
    const slot: GenerationSlot =
      input.inputImages !== undefined && input.inputImages.length > 0
        ? "imageEditing"
        : "imageGeneration";
    const binding = await bindGenerationSlot(this.#resolver, slot, options.modelId);
    const adapter = this.#adapterFor(binding.protocol, slot);
    if (adapter.generateImage === undefined) {
      throw new MediaError(
        "slot-protocol",
        `The connected image provider's adapter does not generate images yet.`,
      );
    }
    const generation = await adapter.generateImage(
      { ...input, modelId: binding.modelId },
      binding satisfies DriverEndpoint,
    );
    return this.#requireJobs().start({
      conversationId: options.conversationId,
      slot,
      description: input.prompt,
      modelId: binding.modelId,
      generation,
    });
  }

  /** Starts a video generation as a job and answers its status at once. */
  async generateVideo(
    input: Omit<VideoGenerationInput, "modelId">,
    options: GenerateOptions,
  ): Promise<MediaJobStatus> {
    const binding = await bindGenerationSlot(this.#resolver, "videoGeneration", options.modelId);
    const adapter = this.#adapterFor(binding.protocol, "videoGeneration");
    if (adapter.generateVideo === undefined) {
      throw new MediaError(
        "slot-protocol",
        `The connected video provider's adapter does not generate video yet.`,
      );
    }
    const generation = await adapter.generateVideo(
      { ...input, modelId: binding.modelId },
      binding satisfies DriverEndpoint,
    );
    return this.#requireJobs().start({
      conversationId: options.conversationId,
      slot: "videoGeneration",
      description: input.prompt,
      modelId: binding.modelId,
      generation,
    });
  }

  #adapterFor(protocol: string, slot: CapabilitySlot): MediaAdapter {
    const adapter = [...this.#adapters.values()].find((candidate) => candidate.protocol === protocol);
    if (adapter === undefined) {
      throw new MediaError(
        "slot-protocol",
        `The connected ${SLOT_WORDS[slot] ?? slot} provider speaks a wire media cannot drive yet.`,
      );
    }
    return adapter;
  }

  #requireJobs(): MediaJobs {
    if (this.#jobs === undefined) {
      throw new MediaError("slot-protocol", "Media generation is not available in this harness.");
    }
    return this.#jobs;
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
    const transcribe = this.#transcribe ?? this.#adapterFor(binding.protocol, "transcription").transcribe;
    if (transcribe === undefined) {
      throw new MediaError(
        "slot-protocol",
        "The connected dictation provider's adapter does not transcribe.",
      );
    }
    return transcribe(
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
    const speak = this.#speech ?? this.#adapterFor(binding.protocol, "speechGeneration").speak;
    if (speak === undefined) {
      throw new MediaError(
        "slot-protocol",
        "The connected read-aloud provider's adapter does not speak.",
      );
    }
    return speak(
      {
        text: input.text,
        modelId: binding.modelId,
        ...(input.voiceId === undefined ? {} : { voiceId: input.voiceId }),
      } satisfies SpeechSlotInput,
      binding satisfies DriverEndpoint,
    );
  }
}
