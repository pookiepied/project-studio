/**
 * File-based configuration service for STUDIO
 * Uses unified storage abstraction (Tauri FS primary, localStorage fallback)
 */

import { AppSettings, ThemePreference } from "@/types";
import { RephraseTone } from "@/lib/prompts";
import { unifiedStorage } from "./unifiedStorageService";
import { migrateModelId } from "@/core/models";
import { logger } from "../logging/logger";
import { isThemePreference } from "@/lib/theme";

const CONFIG_PATH = "STUDIO.conf";

/**
 * Default application settings
 */
export const DEFAULT_SETTINGS: AppSettings = {
  // Audio settings
  selectedMicrophone: undefined,
  autoRephrase: true,
  rephraseTone: RephraseTone.STANDARD,

  // VAD settings
  vadEnabled: true,
  vadSilenceThreshold: 5,

  // Model settings
  transcriptionModel: "groq:whisper-large-v3-turbo",
  rephraseModel: "groq:llama-3.1-8b-instant",
  defaultChatModel: "auto",
  ttsModel: "minimax:speech-2.8-hd:moss_audio_9a66c5a7-437b-11f1-ae64-b65408efbb94", // Text-to-speech model
  imageModel: "openrouter:black-forest-labs/flux.2-pro", // Image generation model
  videoModel: "openrouter:google/veo-3.1-fast", // Video generation model

  // Local LLM settings
  ollamaEnabled: false, // Show Ollama models by default
  ollamaBaseUrl: "http://localhost:11434",
  
  // Local transcription settings
  parakeetEnabled: false, // Disabled by default (requires setup)

  // Local text-to-speech settings
  edgeTtsEnabled: false, // Disabled by default (requires setup)

  // Keyboard shortcuts
  recordingShortcut: ["Ctrl", "Shift", "R"],
  voiceShortcut: ["Ctrl", "Shift", "V"],
  voiceVolume: 80,

  // UI settings
  theme: "system",
  startOnBoot: false,
  minimizeToTray: true,
  showNotifications: true,
  notifyConversationDone: true,

  // API settings
  apiBaseUrl: "https://api.pookiepied.dev",

  // Local provider settings
  lmstudioEnabled: false,
  lmstudioBaseUrl: "http://localhost:1234",
  localProviderEnabled: false,
  localProviderPort: 11435,

  // Pulse island
  overlayOpacity: 100,
  showFloatingIsland: true,

  // Agent mode
  autopilotMode: false,
};

/**
 * Convert settings object to .conf file format
 */
function settingsToConf(settings: AppSettings): string {
  const lines: string[] = [
    "# STUDIO Configuration File",
    "# Edit this file to customize your settings",
    "# Changes take effect after restarting the application",
    "",
    "# Audio Settings",
    `selectedMicrophone=${settings.selectedMicrophone || ""}`,
    `autoRephrase=${settings.autoRephrase}`,
    `vadEnabled=${settings.vadEnabled}`,
    `vadSilenceThreshold=${settings.vadSilenceThreshold}`,
    "",
    "# Model Settings",
    `transcriptionModel=${settings.transcriptionModel}`,
    `rephraseModel=${settings.rephraseModel}`,
    `defaultChatModel=${settings.defaultChatModel}`,
    `ttsModel=${settings.ttsModel}`,
    `imageModel=${settings.imageModel}`,
    `videoModel=${settings.videoModel}`,
    "",
    "# Local LLM Settings",
    `ollamaEnabled=${settings.ollamaEnabled}`,
    `ollamaBaseUrl=${settings.ollamaBaseUrl}`,
    "",
    "# Local Transcription Settings",
    `parakeetEnabled=${settings.parakeetEnabled}`,
    "",
    "# Local Text-to-Speech Settings",
    `edgeTtsEnabled=${settings.edgeTtsEnabled}`,
    "",
    "# Tone Settings",
    `rephraseTone=${settings.rephraseTone}`,
    "",
    "# API Settings",
    `apiBaseUrl=${settings.apiBaseUrl}`,
    "",
    "# Keyboard Shortcuts",
    `recordingShortcut=${settings.recordingShortcut.join("+")}`,
    `voiceShortcut=${settings.voiceShortcut.join("+")}`,
    `voiceVolume=${settings.voiceVolume ?? 80}`,
    "",
    "# UI Settings",
    `theme=${settings.theme}`,
    `startOnBoot=${settings.startOnBoot}`,
    `minimizeToTray=${settings.minimizeToTray}`,
    `showNotifications=${settings.showNotifications}`,
    `notifyConversationDone=${settings.notifyConversationDone}`,
    "",
    "# Local Provider Settings",
    `localProviderEnabled=${settings.localProviderEnabled}`,
    `localProviderPort=${settings.localProviderPort}`,
    `lmstudioEnabled=${settings.lmstudioEnabled}`,
    `lmstudioBaseUrl=${settings.lmstudioBaseUrl}`,
    "",
    "# Agent Mode",
    `autopilotMode=${settings.autopilotMode}`,
    "",
    "# Pulse Island",
    `showFloatingIsland=${settings.showFloatingIsland}`,
    `overlayOpacity=${settings.overlayOpacity}`,
    "",
  ];

  return lines.join("\n");
}

/**
 * Parse .conf file format to settings object
 */
function confToSettings(content: string): Partial<AppSettings> {
  const settings: Partial<AppSettings> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") {
      continue;
    }

    // Parse key=value
    const [key, ...valueParts] = line.split("=");
    const value = valueParts.join("=").trim();

    if (!key || value === undefined) continue;

    const trimmedKey = key.trim();

    // Parse values based on key
    switch (trimmedKey) {
      case "selectedMicrophone":
        settings.selectedMicrophone = value || undefined;
        break;
      case "autoRephrase":
        settings.autoRephrase = value === "true";
        break;
      case "vadEnabled":
        settings.vadEnabled = value === "true";
        break;
      case "vadSilenceThreshold":
        settings.vadSilenceThreshold = parseInt(value, 10);
        break;
      case "transcriptionModel":
        settings.transcriptionModel = value;
        break;
      case "rephraseModel":
        settings.rephraseModel = value;
        break;
      case "defaultChatModel":
        settings.defaultChatModel = value;
        break;
      case "ttsModel":
        settings.ttsModel = value;
        break;
      case "imageModel":
        settings.imageModel = value;
        break;
      case "videoModel":
        settings.videoModel = value;
        break;
      case "rephraseTone":
        settings.rephraseTone = value as RephraseTone;
        break;
      case "recordingShortcut":
        settings.recordingShortcut = value.split("+");
        break;
      case "voiceShortcut":
        settings.voiceShortcut = value ? value.split("+") : [];
        break;
      case "voiceVolume":
        settings.voiceVolume = Math.min(100, Math.max(0, parseInt(value, 10) || 80));
        break;
      case "theme":
        if (isThemePreference(value)) {
          settings.theme = value as ThemePreference;
        }
        break;
      case "startOnBoot":
        settings.startOnBoot = value === "true";
        break;
      case "minimizeToTray":
        settings.minimizeToTray = value === "true";
        break;
      case "showNotifications":
        settings.showNotifications = value === "true";
        break;
      case "notifyConversationDone":
        settings.notifyConversationDone = value === "true";
        break;
      case "apiBaseUrl":
        settings.apiBaseUrl = value;
        break;

      case "ollamaEnabled":
        settings.ollamaEnabled = value === "true";
        break;
      case "ollamaBaseUrl":
        settings.ollamaBaseUrl = value;
        break;
      case "parakeetEnabled":
        settings.parakeetEnabled = value === "true";
        break;
      case "edgeTtsEnabled":
        settings.edgeTtsEnabled = value === "true";
        break;
      case "localProviderEnabled":
        settings.localProviderEnabled = value === "true";
        break;
      case "localProviderPort":
        settings.localProviderPort = parseInt(value, 10);
        break;
      case "lmstudioEnabled":
        settings.lmstudioEnabled = value === "true";
        break;
      case "lmstudioBaseUrl":
        settings.lmstudioBaseUrl = value;
        break;
      case "autopilotMode":
        settings.autopilotMode = value === "true";
        break;
      case "overlayOpacity":
        settings.overlayOpacity = Math.min(100, Math.max(0, parseInt(value, 10) || 100));
        break;
      case "showFloatingIsland":
        settings.showFloatingIsland = value !== "false";
        break;
    }
  }

  return settings;
}

/**
 * Load settings from storage
 */
export async function loadSettingsFromFile(): Promise<AppSettings> {
  const content = await unifiedStorage.readText(CONFIG_PATH);
  
  if (!content) {
    // No existing config, use defaults
    logger.info('Settings', 'No config found, creating defaults');
    await saveSettingsToFile(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }

  const parsed = confToSettings(content);
  
  // Merge with defaults to handle new settings
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
  };

  // Migrate old model IDs to new namespaced format
  let needsSave = false;
  
  if (settings.transcriptionModel && !settings.transcriptionModel.includes(":")) {
    logger.debug('Settings', `Migrating transcriptionModel: ${settings.transcriptionModel}`);
    settings.transcriptionModel = migrateModelId(settings.transcriptionModel);
    needsSave = true;
  }
  
  if (settings.rephraseModel && !settings.rephraseModel.includes(":")) {
    logger.debug('Settings', `Migrating rephraseModel: ${settings.rephraseModel}`);
    settings.rephraseModel = migrateModelId(settings.rephraseModel);
    needsSave = true;
  }
  
  if (settings.defaultChatModel && !settings.defaultChatModel.includes(":") && settings.defaultChatModel !== "auto") {
    logger.debug('Settings', `Migrating defaultChatModel: ${settings.defaultChatModel}`);
    settings.defaultChatModel = migrateModelId(settings.defaultChatModel);
    needsSave = true;
  }

  // Save migrated settings
  if (needsSave) {
    logger.debug('Settings', 'Saving migrated settings');
    await saveSettingsToFile(settings);
  }

  logger.debug('Settings', 'Loaded from storage', {
    transcriptionModel: settings.transcriptionModel,
    rephraseModel: settings.rephraseModel,
    defaultChatModel: settings.defaultChatModel,
    rephraseTone: settings.rephraseTone,
  });

  return settings;
}

/**
 * Save settings to storage
 */
export async function saveSettingsToFile(settings: AppSettings): Promise<void> {
  const content = settingsToConf(settings);
  await unifiedStorage.writeText(CONFIG_PATH, content);
  logger.debug('Settings', 'Saved to storage', {
    transcriptionModel: settings.transcriptionModel,
    rephraseModel: settings.rephraseModel,
    defaultChatModel: settings.defaultChatModel,
    rephraseTone: settings.rephraseTone,
  });
}

/**
 * Get config file location for display.
 *
 * Asks the storage layer where CONFIG_PATH actually resolves rather than
 * restating it. The two must not be able to disagree: on macOS/Linux the app
 * data directory is not %APPDATA%, and under the web backend there is no file
 * at all.
 */
export async function getConfigLocation(): Promise<string> {
  return unifiedStorage.describePath(CONFIG_PATH);
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  await saveSettingsToFile(DEFAULT_SETTINGS);
}

/**
 * Export settings as text
 */
export async function exportSettings(): Promise<string> {
  const settings = await loadSettingsFromFile();
  return settingsToConf(settings);
}
