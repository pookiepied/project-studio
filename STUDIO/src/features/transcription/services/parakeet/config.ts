/**
 * Parakeet-TDT Configuration Service
 * Manages installation state and user preferences. Same addon-under-appData
 * pattern as every other local engine in this app (see e.g.
 * src/features/tts/local/config.ts) — a dedicated venv + config.json under
 * appData/addons/<name>/.
 */

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { logger } from '@/core/logging/logger';

export interface ParakeetConfig {
  installed: boolean;
  pythonPath?: string;
  pythonVersion?: string;
  modelDownloaded: boolean;
  installationDate?: string;
}

const DEFAULT_CONFIG: ParakeetConfig = {
  installed: false,
  modelDownloaded: false,
};

let configCache: ParakeetConfig | null = null;

async function getParakeetDir(): Promise<string> {
  const appData = await appDataDir();
  const normalizedAppData = appData.endsWith('/') || appData.endsWith('\\') ? appData : `${appData}/`;
  return `${normalizedAppData}addons/parakeet`;
}

async function getConfigPath(): Promise<string> {
  const baseDir = await getParakeetDir();
  return `${baseDir}/config.json`;
}

export async function getVenvDir(): Promise<string> {
  const baseDir = await getParakeetDir();
  return `${baseDir}/venv`;
}

export async function getScriptsDir(): Promise<string> {
  const baseDir = await getParakeetDir();
  return `${baseDir}/scripts`;
}

/**
 * Where the downloaded ONNX model files are cached. Passed to the Python
 * scripts as HF_HOME so onnx-asr's Hugging Face download lands here instead
 * of the user's global `~/.cache/huggingface` — keeps the whole addon (venv +
 * scripts + model weights) self-contained under one directory, same as every
 * other local engine in this app, and means deleting addons/parakeet/ is a
 * complete uninstall.
 */
export async function getModelsDir(): Promise<string> {
  const baseDir = await getParakeetDir();
  return `${baseDir}/models`;
}

export async function getVenvPythonPath(): Promise<string> {
  const venvDir = await getVenvDir();
  if (navigator.platform.toLowerCase().includes('win')) {
    return `${venvDir}/Scripts/python.exe`;
  }
  return `${venvDir}/bin/python`;
}

async function ensureDirectoryStructure(): Promise<void> {
  const baseDir = await getParakeetDir();
  const scriptsDir = await getScriptsDir();
  const modelsDir = await getModelsDir();

  for (const dir of [baseDir, scriptsDir, modelsDir]) {
    const exists = await invoke<boolean>('file_exists', { path: dir });
    if (!exists) {
      await invoke('create_directory', { path: dir });
    }
  }
}

export async function loadConfig(): Promise<ParakeetConfig> {
  if (configCache) return configCache;

  try {
    const configPath = await getConfigPath();
    const exists = await invoke<boolean>('file_exists', { path: configPath });
    if (!exists) {
      configCache = { ...DEFAULT_CONFIG };
      return configCache;
    }

    const content = await invoke<string>('read_text_file', { path: configPath });
    const parsed = JSON.parse(content) as ParakeetConfig;
    configCache = { ...DEFAULT_CONFIG, ...parsed };
    return configCache;
  } catch (error) {
    logger.error('ParakeetConfig', 'Failed to load configuration', error);
    configCache = { ...DEFAULT_CONFIG };
    return configCache;
  }
}

async function saveConfig(config: Partial<ParakeetConfig>): Promise<void> {
  await ensureDirectoryStructure();
  const currentConfig = await loadConfig();
  const updatedConfig: ParakeetConfig = { ...currentConfig, ...config };

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

export async function markModelDownloaded(): Promise<void> {
  await saveConfig({ modelDownloaded: true });
}
