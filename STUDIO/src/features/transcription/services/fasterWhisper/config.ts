/**
 * Faster Whisper Configuration Service
 * Manages user preferences and installation state
 */

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { logger } from '@/core/logging/logger';

export interface FasterWhisperConfig {
  installed: boolean;
  pythonPath?: string;
  pythonVersion?: string;
  device: 'cuda' | 'cpu';
  selectedModel?: string;
  quantization: string;
  installedModels: string[];
  installationDate?: string;
  lastUsed?: string;
}

const DEFAULT_CONFIG: FasterWhisperConfig = {
  installed: false,
  device: 'cpu',
  quantization: 'float32',
  installedModels: [],
};

let configCache: FasterWhisperConfig | null = null;

/**
 * Get Faster Whisper base directory
 * Should be: AppData/Roaming/com.pookiepied.studio/addons/faster-whisper/
 */
async function getFasterWhisperDir(): Promise<string> {
  const appData = await appDataDir();
  logger.debug('Config', 'App data directory', { appData });
  
  // Ensure we're using the correct path structure
  // appDataDir() returns: "C:/Users/username/AppData/Roaming/com.pookiepied.studio/"
  // We want: "C:/Users/username/AppData/Roaming/com.pookiepied.studio/addons/faster-whisper/"
  
  // Ensure appData ends with a separator
  const normalizedAppData = appData.endsWith('/') || appData.endsWith('\\') 
    ? appData 
    : `${appData}/`;
  
  const fasterWhisperPath = `${normalizedAppData}addons/faster-whisper`;
  logger.debug('Config', 'Faster Whisper directory', { path: fasterWhisperPath });
  
  return fasterWhisperPath;
}

/**
 * Get configuration file path
 */
async function getConfigPath(): Promise<string> {
  const baseDir = await getFasterWhisperDir();
  return `${baseDir}/config.json`;
}

/**
 * Get models directory path
 */
export async function getModelsDir(): Promise<string> {
  const baseDir = await getFasterWhisperDir();
  return `${baseDir}/models`;
}

/**
 * Get virtual environment directory path
 */
export async function getVenvDir(): Promise<string> {
  const baseDir = await getFasterWhisperDir();
  return `${baseDir}/venv`;
}

/**
 * Get scripts directory path
 */
export async function getScriptsDir(): Promise<string> {
  const baseDir = await getFasterWhisperDir();
  return `${baseDir}/scripts`;
}

/**
 * Get Python executable path in venv
 */
export async function getVenvPythonPath(): Promise<string> {
  const venvDir = await getVenvDir();
  
  // Platform-specific Python path
  if (navigator.platform.toLowerCase().includes('win')) {
    return `${venvDir}/Scripts/python.exe`;
  }
  return `${venvDir}/bin/python`;
}

/**
 * Ensure Faster Whisper directory structure exists
 */
/**
 * Ensure Faster Whisper directory structure exists
 */
async function ensureDirectoryStructure(): Promise<void> {
  const baseDir = await getFasterWhisperDir();
  const modelsDir = await getModelsDir();
  const scriptsDir = await getScriptsDir();
  
  try {
    // Create base directory
    const baseExists = await invoke<boolean>('file_exists', { path: baseDir });
    if (!baseExists) {
      await invoke('create_directory', { path: baseDir });
    }
    
    // Create models directory
    const modelsExists = await invoke<boolean>('file_exists', { path: modelsDir });
    if (!modelsExists) {
      await invoke('create_directory', { path: modelsDir });
    }
    
    // Create scripts directory
    const scriptsExists = await invoke<boolean>('file_exists', { path: scriptsDir });
    if (!scriptsExists) {
      await invoke('create_directory', { path: scriptsDir });
    }
  } catch (error) {
    logger.error('Config', 'Failed to create Faster Whisper directories', error);
    throw error;
  }
}

/**
 * Load configuration from disk
 */
export async function loadConfig(): Promise<FasterWhisperConfig> {
  // Return cached config if available
  if (configCache) {
    return configCache;
  }
  
  try {
    const configPath = await getConfigPath();
    
    // Check if config file exists
    const exists = await invoke<boolean>('file_exists', { path: configPath });
    if (!exists) {
      // Return default config
      configCache = { ...DEFAULT_CONFIG };
      return configCache;
    }
    
    // Read and parse config
    const content = await invoke<string>('read_text_file', { path: configPath });
    const config = JSON.parse(content) as FasterWhisperConfig;
    
    // Merge with defaults (in case new fields were added)
    configCache = { ...DEFAULT_CONFIG, ...config };
    return configCache;
  } catch (error) {
    logger.error('Config', 'Failed to load Faster Whisper configuration', error);
    // Return default config on error
    configCache = { ...DEFAULT_CONFIG };
    return configCache;
  }
}

/**
 * Save configuration to disk
 */
async function saveConfig(config: Partial<FasterWhisperConfig>): Promise<void> {
  try {
    // Ensure directory structure exists
    await ensureDirectoryStructure();
    
    // Load current config
    const currentConfig = await loadConfig();
    
    // Merge with new config
    const updatedConfig: FasterWhisperConfig = {
      ...currentConfig,
      ...config,
    };
    
    // Save to disk
    const configPath = await getConfigPath();
    await invoke('write_text_file', { 
      path: configPath, 
      content: JSON.stringify(updatedConfig, null, 2) 
    });
    
    // Update cache
    configCache = updatedConfig;
    
    logger.info('Config', 'Faster Whisper configuration saved');
  } catch (error) {
    logger.error('Config', 'Failed to save Faster Whisper configuration', error);
    throw error;
  }
}

/**
 * Mark installation as complete
 */
export async function markInstalled(pythonPath: string, pythonVersion: string, device: 'cuda' | 'cpu'): Promise<void> {
  await saveConfig({
    installed: true,
    pythonPath,
    pythonVersion,
    device,
    installationDate: new Date().toISOString(),
  });
}

/**
 * Add installed model to config
 */
export async function addInstalledModel(modelName: string): Promise<void> {
  const config = await loadConfig();
  
  if (!config.installedModels.includes(modelName)) {
    const updatedModels = [...config.installedModels, modelName];
    await saveConfig({
      installedModels: updatedModels,
      // Set as selected if no model selected yet
      selectedModel: config.selectedModel || modelName,
    });
  }
}

/**
 * Remove installed model from config
 */
export async function removeInstalledModel(modelName: string): Promise<void> {
  const config = await loadConfig();
  
  const updatedModels = config.installedModels.filter(m => m !== modelName);
  
  await saveConfig({
    installedModels: updatedModels,
    // Clear selected model if it was the removed one
    selectedModel: config.selectedModel === modelName ? undefined : config.selectedModel,
  });
}

/**
 * Set selected model
 */
export async function setSelectedModel(modelName: string): Promise<void> {
  await saveConfig({
    selectedModel: modelName,
    lastUsed: new Date().toISOString(),
  });
}

/**
 * Get installed models
 */
export async function getInstalledModels(): Promise<string[]> {
  const config = await loadConfig();
  return config.installedModels;
}
