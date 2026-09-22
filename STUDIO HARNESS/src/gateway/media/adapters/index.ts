import type { MediaAdapters } from "./types.js";
import { deepgramMedia } from "./deepgram.js";
import { elevenlabsMedia } from "./elevenlabs.js";
import { falMedia } from "./fal.js";
import { fishAudioMedia } from "./fish-audio.js";
import { googleMedia } from "./google.js";
import { minimaxMedia } from "./minimax.js";
import { mistralMedia } from "./mistral.js";
import { openaiMedia } from "./openai.js";
import { openrouterMedia } from "./openrouter.js";

export type { MediaAdapters } from "./types.js";

/**
 * The adapters this build ships, by the media wire each speaks.
 *
 * One entry per step of the gateway plan as it lands: OpenRouter first,
 * because one key the person already holds reaches the widest catalogue.
 * A wire in `mediaProtocolSchema` with no entry here is a connection the
 * settings can make and the service refuses to drive, in a sentence that
 * says so.
 */
export function builtinMediaAdapters(): MediaAdapters {
  return new Map(
    [
      openrouterMedia,
      openaiMedia,
      elevenlabsMedia,
      googleMedia,
      falMedia,
      deepgramMedia,
      fishAudioMedia,
      minimaxMedia,
      mistralMedia,
    ].map((adapter) => [adapter.protocol, adapter]),
  );
}
