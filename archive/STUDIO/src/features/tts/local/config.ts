/**
 * Edge TTS Configuration Service
 * Manages installation state and user preferences.
 * Mirrors the Faster Whisper config pattern (see
 * src/features/transcription/services/fasterWhisper/config.ts) — every local
 * "addon" lives under appData/addons/<name>/ with its own venv + config.json.
 */

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { logger } from '@/core/logging/logger';

export interface EdgeTtsConfig {
  installed: boolean;
  pythonPath?: string;
  pythonVersion?: string;
  installationDate?: string;
}

const DEFAULT_CONFIG: EdgeTtsConfig = {
  installed: false,
};

let configCache: EdgeTtsConfig | null = null;

async function getEdgeTtsDir(): Promise<string> {
  const appData = await appDataDir();
  const normalizedAppData = appData.endsWith('/') || appData.endsWith('\\') ? appData : `${appData}/`;
  return `${normalizedAppData}addons/edge-tts`;
}

async function getConfigPath(): Promise<string> {
  const baseDir = await getEdgeTtsDir();
  return `${baseDir}/config.json`;
}

export async function getVenvDir(): Promise<string> {
  const baseDir = await getEdgeTtsDir();
  return `${baseDir}/venv`;
}

export async function getScriptsDir(): Promise<string> {
  const baseDir = await getEdgeTtsDir();
  return `${baseDir}/scripts`;
}

export async function getVenvPythonPath(): Promise<string> {
  const venvDir = await getVenvDir();
  if (navigator.platform.toLowerCase().includes('win')) {
    return `${venvDir}/Scripts/python.exe`;
  }
  return `${venvDir}/bin/python`;
}

async function ensureDirectoryStructure(): Promise<void> {
  const baseDir = await getEdgeTtsDir();
  const scriptsDir = await getScriptsDir();

  for (const dir of [baseDir, scriptsDir]) {
    const exists = await invoke<boolean>('file_exists', { path: dir });
    if (!exists) {
      await invoke('create_directory', { path: dir });
    }
  }
}

export async function loadConfig(): Promise<EdgeTtsConfig> {
  if (configCache) return configCache;

  try {
    const configPath = await getConfigPath();
    const exists = await invoke<boolean>('file_exists', { path: configPath });
    if (!exists) {
      configCache = { ...DEFAULT_CONFIG };
      return configCache;
    }

    const content = await invoke<string>('read_text_file', { path: configPath });
    const parsed = JSON.parse(content) as EdgeTtsConfig;
    configCache = { ...DEFAULT_CONFIG, ...parsed };
    return configCache;
  } catch (error) {
    logger.error('EdgeTtsConfig', 'Failed to load configuration', error);
    configCache = { ...DEFAULT_CONFIG };
    return configCache;
  }
}

async function saveConfig(config: Partial<EdgeTtsConfig>): Promise<void> {
  await ensureDirectoryStructure();
  const currentConfig = await loadConfig();
  const updatedConfig: EdgeTtsConfig = { ...currentConfig, ...config };

  const configPath = await getConfigPath();
  await invoke('write_text_file', {
    path: configPath,
    content: JSON.stringify(updatedConfig, null, 2),
  });

  configCache = updatedConfig;
}

export async function markInstalled(pythonPath: string, pythonVersion: string): Promise<void> {
  await saveConfig({
    installed: true,
    pythonPath,
    pythonVersion,
    installationDate: new Date().toISOString(),
  });
}
