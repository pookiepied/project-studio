/**
 * Faster Whisper Service
 * Local audio transcription using Faster Whisper
 */

// System Detection
export {
  detectSystemCapabilities,
  isPythonVersionSupported,
  getRecommendedDevice,
  getRecommendedQuantization,
  type SystemInfo,
  type GPUInfo,
} from './systemDetection';

// Model Metadata
export {
  getModelById,
  getAllModelNames,
  supportsTranslation,
  getQuantizationOptions,
  getRecommendedModels,
  getModelsBySize,
  FASTER_WHISPER_MODELS,
  type FasterWhisperModel,
} from './modelMetadata';

// Configuration
export {
  loadConfig,
  saveConfig,
  updateConfig,
  markInstalled,
  addInstalledModel,
  removeInstalledModel,
  setSelectedModel,
  setDevice,
  setQuantization,
  isInstalled,
  getInstalledModels,
  getSelectedModel,
  resetConfig,
  clearCache,
  getFasterWhisperDir,
  getModelsDir,
  getVenvDir,
  getScriptsDir,
  getVenvPythonPath,
  type FasterWhisperConfig,
} from './config';

// Installation
export {
  installFasterWhisper,
  checkVenvExists,
  verifyInstallation,
  type InstallationProgress,
  type InstallationResult,
} from './installationService';

// Model Management
export {
  downloadModel,
  deleteModel,
  getInstalledModelsInfo,
  validateModel,
  getModelSize,
  cleanupIncompleteDownloads,
  getModelPath,
  isModelDownloaded,
  type ModelDownloadProgress,
  type InstalledModelInfo,
} from './modelManager';

// Transcription
export {
  transcribeWithFasterWhisper,
  isFasterWhisperReady,
  getTranscriptionStatus,
  type TranscriptionResult,
  type TranscriptionOptions,
} from './transcriptionService';
