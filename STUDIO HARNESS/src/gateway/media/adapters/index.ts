import type { MediaAdapters } from "./types.js";
import { elevenlabsMedia } from "./elevenlabs.js";
import { falMedia } from "./fal.js";
import { googleMedia } from "./google.js";
import { openaiMedia } from "./openai.js";
import { openrouterMedia } from "./openrouter.js";

export type { MediaAdapter, MediaAdapters, MediaBytes } from "./types.js";

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
    [openrouterMedia, openaiMedia, elevenlabsMedia, googleMedia, falMedia].map((adapter) => [
      adapter.protocol,
      adapter,
    ]),
  );
}
