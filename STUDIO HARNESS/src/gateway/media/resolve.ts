import type { CapabilitySlot, MediaProtocol } from "../../contracts/providers.js";
import { MediaError } from "../../contracts/media.js";
import type { CapabilityResolver, CapabilityResolution } from "../connections/capability-defaults.js";
import { libraryBaseUrlFor } from "../catalog/index.js";
import type { DriverEndpoint } from "./drivers/types.js";
import { createObservationWriter } from "../../observability/recorder.js";

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

const LABELS: Readonly<Record<GenerationSlot | "speechGeneration" | "transcription" | "documentReading", string>> = {
  speechGeneration: "read-aloud",
  transcription: "dictation",
  imageGeneration: "image",
  imageEditing: "image editing",
  videoGeneration: "video",
  documentReading: "document reading",
};

export type GenerationSlot = "imageGeneration" | "imageEditing" | "videoGeneration";

/**
 * The language wires whose hosts also answer OpenAI's audio endpoints: a
 * self-hosted OpenAI-compatible endpoint serves dictation off the same base
 * URL as chat, with no media wire of its own. The binding names `openai` for
 * such a connection so the OpenAI adapter drives it.
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
  const record = createObservationWriter();
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
  const baseUrl = addressOf(connection, slot);
  record({ name: "media.binding", phase: "progress", attributes: { stage: "resolved", slot,
    connectionId: connection.id, protocol, modelId: requestedModelId ?? model.modelId } });
  return {
    slot,
    protocol,
    baseUrl,
    credential: resolution.credential,
    modelId: requestedModelId ?? model.modelId,
  };
}

/**
 * Binding the document-reading slot: a media wire or nothing, like a
 * generation. The OpenAI-shaped audio fallback has no counterpart here
 * because reading a file through the Responses API is OpenAI's own wire,
 * not the compatible surface a self-hosted endpoint copies.
 */
export async function bindDocumentSlot(
  resolver: CapabilityResolver,
  requestedModelId?: string,
): Promise<MediaBinding & { readonly protocol: MediaProtocol }> {
  const record = createObservationWriter();
  const slot = "documentReading";
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
  const baseUrl = addressOf(connection, slot);
  record({ name: "media.binding", phase: "progress", attributes: { stage: "resolved", slot,
    connectionId: connection.id, protocol, modelId: requestedModelId ?? model.modelId } });
  return {
    slot,
    protocol,
    baseUrl,
    credential: resolution.credential,
    modelId: requestedModelId ?? model.modelId,
  };
}

export async function bindAudioSlot(
  resolver: CapabilityResolver,
  slot: "speechGeneration" | "transcription",
  requestedModelId?: string,
): Promise<MediaBinding> {
  const record = createObservationWriter();
  const resolution: CapabilityResolution | undefined = await resolver.resolve(slot);
  if (resolution === undefined) {
    throw new MediaError(
      "slot-unset",
      `No ${LABELS[slot]} model is connected. Choose one in Settings - Providers.`,
    );
  }

  const { connection, model } = resolution;
  // A media wire when the connection has one; else a language connection on
  // one of the OpenAI wires, whose base URL also answers /audio - how an
  // OpenAI-compatible self-hosted endpoint serves dictation. Which adapters
  // exist is the service's knowledge; what is refused here is a connection
  // with no wire audio could ride.
  const language = connection.serves.language;
  const protocol =
    connection.serves.media ??
    (language !== undefined && OPENAI_AUDIO_PROTOCOLS.has(language) ? "openai" : undefined);
  if (protocol === undefined) {
    throw new MediaError(
      "slot-protocol",
      `The connected ${LABELS[slot]} provider speaks a protocol media cannot drive yet.`,
    );
  }
  const baseUrl = addressOf(connection, slot);
  record({ name: "media.binding", phase: "progress", attributes: { stage: "resolved", slot,
    connectionId: connection.id, protocol, modelId: requestedModelId ?? model.modelId } });

  return {
    slot,
    protocol,
    baseUrl,
    credential: resolution.credential,
    // An explicit model (a route body naming one) outranks the slot's choice,
    // which is how a person with two transcription models picks without
    // revisiting Settings mid-sentence.
    modelId: requestedModelId ?? model.modelId,
  };
}

/**
 * Where a connection is called: the address the person typed, else the
 * vendor's own from the library. A connection added from the library
 * carries no address of its own on purpose - absent means the vendor's -
 * so this is the only place the two are joined for media.
 */
function addressOf(connection: CapabilityResolution["connection"], slot: keyof typeof LABELS): string {
  const baseUrl = connection.baseUrl ?? libraryBaseUrlFor(connection.catalogProvider ?? "");
  if (baseUrl === undefined) {
    throw new MediaError(
      "slot-protocol",
      `The connected ${LABELS[slot]} provider has no base URL to call.`,
    );
  }
  return baseUrl;
}
