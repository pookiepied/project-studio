import type { CapabilitySlot } from "../../contracts/providers.js";
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

const LABELS: Readonly<Record<"speechGeneration" | "transcription", string>> = {
  speechGeneration: "read-aloud",
  transcription: "dictation",
};

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
  if (connection.kind === "media" && connection.protocol === "elevenlabs") {
    throw new MediaError(
      "slot-protocol",
      "ElevenLabs cannot serve this yet; connect an OpenAI-compatible provider for it.",
    );
  }
  if (connection.kind !== "language" || !OPENAI_AUDIO_PROTOCOLS.has(connection.protocol)) {
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
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    credential: resolution.credential,
    // An explicit model (a route body naming one) outranks the slot's choice,
    // which is how a person with two transcription models picks without
    // revisiting Settings mid-sentence.
    modelId: requestedModelId ?? model.modelId,
  };
}
