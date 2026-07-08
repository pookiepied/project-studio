import { AppSettings } from "../../types";
import { RephraseTone } from "../../utils/prompts";
import {
  loadSettingsFromFile,
  saveSettingsToFile,
  resetSettings as resetFileSettings,
  updateSetting as updateFileSetting,
  exportSettings as exportFileSettings,
  importSettings as importFileSettings,
  getConfigLocation,
  DEFAULT_SETTINGS,
} from "./fileConfigService";
import { isThemePreference } from "../../utils/theme";

/**
 * Load settings (uses unified storage)
 */
export async function loadSettings(): Promise<AppSettings> {
  return await loadSettingsFromFile();
}

/**
 * Load settings synchronously (for initial render, uses cached or defaults)
 */
export function loadSettingsSync(): AppSettings {
  // Return defaults for sync access - actual settings loaded async
  return DEFAULT_SETTINGS;
}

/**
 * Save settings (uses unified storage)
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
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
export async function resetSettings(): Promise<void> {
  await resetFileSettings();
}

/**
 * Get a specific setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const settings = await loadSettings();
  return settings[key];
}

/**
 * Update a specific setting
 */
export async function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  await updateFileSetting(key, value);
}

/**
 * Export settings as text
 */
export async function exportSettings(): Promise<string> {
  return await exportFileSettings();
}

/**
 * Import settings from text
 */
export async function importSettings(content: string): Promise<boolean> {
  return await importFileSettings(content);
}

/**
 * Get config file location
 */
export async function getConfigFileLocation(): Promise<string> {
  return await getConfigLocation();
}

/**
 * Validate settings object
 */
export function validateSettings(settings: Partial<AppSettings>): boolean {
  // Basic validation
  if (settings.rephraseTone && !Object.values(RephraseTone).includes(settings.rephraseTone as RephraseTone)) {
    return false;
  }

  if (settings.theme && !isThemePreference(settings.theme)) {
    return false;
  }

  if (settings.vadSilenceThreshold !== undefined) {
    if (settings.vadSilenceThreshold < 0 || settings.vadSilenceThreshold > 255) {
      return false;
    }
  }

  return true;
}

/**
 * Config service object
 */
export const configService = {
  load: loadSettings,
  loadSync: loadSettingsSync,
  save: saveSettings,
  reset: resetSettings,
  get: getSetting,
  update: updateSetting,
  export: exportSettings,
  import: importSettings,
  validate: validateSettings,
  getLocation: getConfigFileLocation,
  defaults: DEFAULT_SETTINGS,
};
