/**
 * Edge TTS Service
 * Local text-to-speech using Microsoft Edge TTS (via the `edge-tts` Python
 * package). Free, multilingual (100+ locales), but not a local model — it
 * calls out to Microsoft's cloud voice service, so it still requires an
 * internet connection.
 *
 * This barrel is the module's public surface: only what callers outside
 * tts/local/ actually consume. Files inside the folder import each other by
 * relative path and must not go through here.
 */

export {
  CURATED_EDGE_TTS_VOICES,
} from './voices';

export {
  loadConfig,
  type EdgeTtsConfig,
} from './config';

export {
  detectPython,
} from './systemDetection';

export {
  installEdgeTts,
  type InstallationProgress,
} from './installationService';

export {
  synthesizeSpeech,
  isEdgeTtsModel,
  voiceIdFromModel,
  modelFromVoiceId,
} from './synthesisService';

export { chunkTextForSpeech } from './textChunker';
