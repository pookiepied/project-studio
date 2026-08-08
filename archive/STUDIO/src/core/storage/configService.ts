import { AppSettings } from "@/types";
import {
  loadSettingsFromFile,
  saveSettingsToFile,
  resetSettings as resetFileSettings,
  exportSettings as exportFileSettings,
  getConfigLocation,
  DEFAULT_SETTINGS,
} from "./fileConfigService";

/**
 * Load settings (uses unified storage)
 */
async function loadSettings(): Promise<AppSettings> {
  return await loadSettingsFromFile();
}

/**
 * Load settings synchronously (for initial render, uses cached or defaults)
 */
function loadSettingsSync(): AppSettings {
  // Return defaults for sync access - actual settings loaded async
  return DEFAULT_SETTINGS;
}

/**
 * Save settings (uses unified storage)
 */
async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await loadSettings();
  const updated = {
    ...current,
    ...settings,
  };

  await saveSettingsToFile(updated);
}

/**
 * Reset settings to defaults
 */
async function resetSettings(): Promise<void> {
  await resetFileSettings();
}

/**
 * Export settings as text
 */
async function exportSettings(): Promise<string> {
  return await exportFileSettings();
}

/**
 * Get config file location
 */
async function getConfigFileLocation(): Promise<string> {
  return await getConfigLocation();
}

/**
 * Config service object
 */
export const configService = {
  load: loadSettings,
  loadSync: loadSettingsSync,
  save: saveSettings,
  reset: resetSettings,
  export: exportSettings,
  getLocation: getConfigFileLocation,
};
