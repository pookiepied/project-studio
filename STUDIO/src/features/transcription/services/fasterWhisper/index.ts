/**
 * Faster Whisper Service
 * Local audio transcription using Faster Whisper.
 *
 * This barrel is the module's public surface: only what callers outside
 * fasterWhisper/ actually consume. Files inside the folder import each other by
 * relative path and must not go through here.
 */

// System Detection
export { detectSystemCapabilities } from './systemDetection';

// Model Metadata
export {
  getModelById,
  getRecommendedModels,
} from './modelMetadata';

// Configuration
export {
  loadConfig,
  setSelectedModel,
  type FasterWhisperConfig,
} from './config';

// Installation
export {
  installFasterWhisper,
  type InstallationProgress,
} from './installationService';

// Model Management
export {
  downloadModel,
  deleteModel,
  getInstalledModelsInfo,
  type ModelDownloadProgress,
  type InstalledModelInfo,
} from './modelManager';

// Transcription
export {
  transcribeWithFasterWhisper,
} from './transcriptionService';
