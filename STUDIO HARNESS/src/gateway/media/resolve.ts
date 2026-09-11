import type { CapabilitySlot, MediaProtocol } from "../../contracts/providers.js";
import { MediaError } from "../../contracts/media.js";
import type { CapabilityResolver, CapabilityResolution } from "../connections/capability-defaults.js";
import type { DriverEndpoint } from "./drivers/types.js";

/**
 * Binding a capability slot to a media driver.
 *
 * The ONLY module in `media/` that names capability slots or reads the
 * resolver. Everything downstream speaks `MediaBinding` - a base URL, a
 * credential, a model id - and neither knows nor cares that the answer came
 * from the provider store's defaults.
 *
 * The label in each error is the slot's own product name, because the person
 * who can fix a refusal is reading it from the composer, not from a taxonomy.
 */

const LABELS: Readonly<Record<GenerationSlot | "speechGeneration" | "transcription", string>> = {
  speechGeneration: "read-aloud",
  transcription: "dictation",
  imageGeneration: "image",
  imageEditing: "image editing",
  videoGeneration: "video",
};

export type GenerationSlot = "imageGeneration" | "imageEditing" | "videoGeneration";

/**
 * The protocols media can drive today, and what to say about the ones it
 * cannot. OpenAI's audio endpoints hang off the same base URL as chat, so
 * both chat protocols serve; ElevenLabs has a real protocol value in the
 * store but no driver yet, and it is named as such rather than lumped into
 * "unknown".
 */
const OPENAI_AUDIO_PROTOCOLS: ReadonlySet<string> = new Set([
  "openai-completions",
  "openai-responses",
]);

export interface MediaBinding extends DriverEndpoint {
  readonly slot: CapabilitySlot;
  readonly protocol: string;
  readonly modelId: string;
}

/**
 * Binding an image or video slot to the adapter its connection speaks.
 *
 * Simpler than the audio binding because there is no OpenAI-shaped
 * fallback: a generation goes through a media family or not at all, and
 * the family is `serves.media` on the connection the slot's default names.
 * Which adapters exist is the service's knowledge, not this file's; what is
 * refused here is a connection with no media wire, or no address.
 */
export async function bindGenerationSlot(
  resolver: CapabilityResolver,
  slot: GenerationSlot,
  requestedModelId?: string,
): Promise<MediaBinding & { readonly protocol: MediaProtocol }> {
  const resolution: CapabilityResolution | undefined = await resolver.resolve(slot);
  if (resolution === undefined) {
    throw new MediaError(
      "slot-unset",
      `No ${LABELS[slot]} model is connected. Choose one in Settings - Providers.`,
    );
  }
  const { connection, model } = resolution;
  const protocol = connection.serves.media;
  if (protocol === undefined) {
    throw new MediaError(
      "slot-protocol",
      `The connected ${LABELS[slot]} provider serves no media wire.`,
    );
  }
  if (connection.baseUrl === undefined) {
    throw new MediaError(
      "slot-protocol",
      `The connected ${LABELS[slot]} provider has no base URL to call.`,
    );
  }
  return {
    slot,
    protocol,
    baseUrl: connection.baseUrl,
    credential: resolution.credential,
    modelId: requestedModelId ?? model.modelId,
  };
}

export async function bindAudioSlot(
  resolver: CapabilityResolver,
  slot: "speechGeneration" | "transcription",
  requestedModelId?: string,
): Promise<MediaBinding> {
  const resolution: CapabilityResolution | undefined = await resolver.resolve(slot);
  if (resolution === undefined) {
    throw new MediaError(
      "slot-unset",
      `No ${LABELS[slot]} model is connected. Choose one in Settings - Providers.`,
    );
  }

  const { connection, model } = resolution;
  if (connection.serves.media === "elevenlabs") {
    throw new MediaError(
      "slot-protocol",
      "ElevenLabs cannot serve this yet; connect an OpenAI-compatible provider for it.",
    );
  }
  // The OpenAI drivers speak the audio endpoints of any OpenAI-shaped host:
  // OpenAI's own media family, or a language connection on one of the
  // OpenAI wires whose base URL also answers /audio. The second case is how
  // an OpenAI-compatible self-hosted endpoint serves dictation.
  const language = connection.serves.language;
  const openaiShaped =
    connection.serves.media === "openai" ||
    (language !== undefined && OPENAI_AUDIO_PROTOCOLS.has(language));
  if (!openaiShaped) {
    throw new MediaError(
      "slot-protocol",
      `The connected ${LABELS[slot]} provider speaks a protocol media cannot drive yet.`,
    );
  }
  if (connection.baseUrl === undefined) {
    throw new MediaError(
      "slot-protocol",
      `The connected ${LABELS[slot]} provider has no base URL to call.`,
    );
  }

  return {
    slot,
    // The wire the driver is chosen by: the media family when the connection
    // has one, else the language wire whose host also answers /audio.
    protocol: connection.serves.media ?? language ?? "openai",
    baseUrl: connection.baseUrl,
    credential: resolution.credential,
    // An explicit model (a route body naming one) outranks the slot's choice,
    // which is how a person with two transcription models picks without
    // revisiting Settings mid-sentence.
    modelId: requestedModelId ?? model.modelId,
  };
}
