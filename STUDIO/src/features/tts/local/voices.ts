/**
 * Curated Edge TTS voice list.
 *
 * Microsoft Edge TTS (via the `edge-tts` Python package) exposes 300+ neural
 * voices across 100+ locales — it is fully multilingual, not English-only.
 * This list is a small, human-readable curated subset (English accents plus
 * a handful of major world languages) so the settings UI stays uncluttered.
 * `installationService` can list the full live catalog via
 * `edge-tts --list-voices` if a "browse all voices" UI is ever added.
 */

export interface EdgeTtsVoice {
  /** Raw edge-tts voice id, e.g. "en-US-AndrewNeural". */
  id: string;
  /** Human-readable label, e.g. "Andrew (US, Male)". */
  label: string;
  /** BCP-47 locale, e.g. "en-US". */
  locale: string;
}

export const CURATED_EDGE_TTS_VOICES: EdgeTtsVoice[] = [
  { id: "en-US-AndrewNeural", label: "Andrew (US, Male)", locale: "en-US" },
  { id: "en-US-AriaNeural", label: "Aria (US, Female)", locale: "en-US" },
  { id: "en-GB-RyanNeural", label: "Ryan (UK, Male)", locale: "en-GB" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK, Female)", locale: "en-GB" },
  { id: "en-AU-WilliamNeural", label: "William (Australia, Male)", locale: "en-AU" },
  { id: "en-IN-NeerjaNeural", label: "Neerja (India, Female)", locale: "en-IN" },
  { id: "es-ES-AlvaroNeural", label: "Álvaro (Spanish, Male)", locale: "es-ES" },
  { id: "fr-FR-DeniseNeural", label: "Denise (French, Female)", locale: "fr-FR" },
];

export function getVoiceLabel(voiceId: string): string {
  return CURATED_EDGE_TTS_VOICES.find((v) => v.id === voiceId)?.label ?? voiceId;
}
