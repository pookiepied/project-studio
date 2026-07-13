/**
 * Parakeet-TDT Service
 * Local speech-to-text via NVIDIA's Parakeet-TDT 0.6B v2 (ONNX export, run
 * through the `onnx-asr` Python package). English + ~25 European languages,
 * notably resistant to hallucinating text on silence; the failure mode that
 * made both local Faster Whisper and cloud Groq Whisper unreliable for us.
 *
 * This barrel is the module's public surface: only what callers outside
 * parakeet/ actually consume. Files inside the folder import each other by
 * relative path and must not go through here.
 */

export {
  loadConfig,
  type ParakeetConfig,
} from './config';

export {
  detectSystemCapabilities,
} from './systemDetection';

export {
  installParakeet,
  MODEL_NAME,
  type InstallationProgress,
} from './installationService';

export {
  transcribeWithParakeet,
} from './transcriptionService';
