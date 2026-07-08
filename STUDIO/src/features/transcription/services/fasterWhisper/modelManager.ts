/**
 * Faster Whisper Model Manager
 * Handles model downloads, validation, and management
 */

import { invoke } from '@tauri-apps/api/core';
import { APIResponse } from '@/types';
import { errorService } from '@/services/errors/errorService';
import { logger } from '@/services/logging/logger';
import { 
  getModelsDir, 
  getVenvPythonPath, 
  getScriptsDir,
  addInstalledModel,
  removeInstalledModel,
  getInstalledModels 
} from './config';
import { getModelById, FasterWhisperModel } from './modelMetadata';

export interface ModelDownloadProgress {
  modelName: string;
  status: 'downloading' | 'validating' | 'complete' | 'failed';
  progress: number; // 0-1
  message: string;
}

export interface InstalledModelInfo {
  name: string;
  path: string;
  size: number;
  metadata: FasterWhisperModel;
}

/**
 * Get model directory path
 */
export async function getModelPath(modelName: string): Promise<string> {
  const modelsDir = await getModelsDir();
  return `${modelsDir}/${modelName}`;
}

/**
 * Check if model is downloaded
 */
export async function isModelDownloaded(modelName: string): Promise<boolean> {
  try {
    const modelPath = await getModelPath(modelName);
    return await invoke<boolean>('file_exists', { path: modelPath });
  } catch {
    return false;
  }
}

/**
 * Download model from HuggingFace
 */
export async function downloadModel(
  modelName: string,
  onProgress: (progress: ModelDownloadProgress) => void
): Promise<APIResponse<string>> {
  try {
    onProgress({
      modelName,
      status: 'downloading',
      progress: 0,
      message: 'Starting download...',
    });
    
    // Get paths
    const pythonPath = await getVenvPythonPath();
    const scriptsDir = await getScriptsDir();
    const modelPath = await getModelPath(modelName);
    
    // Check if already downloaded
    const isAlreadyDownloaded = await invoke<boolean>('file_exists', { path: modelPath });
    if (isAlreadyDownloaded) {
      onProgress({
        modelName,
        status: 'complete',
        progress: 1,
        message: 'Model already downloaded',
      });
      
      await addInstalledModel(modelName);
      
      return {
        success: true,
        data: modelPath,
      };
    }
    
    onProgress({
      modelName,
      status: 'downloading',
      progress: 0.1,
      message: 'Downloading from HuggingFace...',
    });
    
    // Execute download script
    const result = await invoke<string>('execute_shell_command', {
      command: pythonPath,
      args: [`${scriptsDir}/download_model.py`, modelName, modelPath],
    });
    
    // Parse result
    const parsed = JSON.parse(result);
    
    if (!parsed.success) {
      throw new Error(parsed.error || 'Download failed');
    }
    
    onProgress({
      modelName,
      status: 'validating',
      progress: 0.9,
      message: 'Validating model files...',
    });
    
    // Validate model was downloaded
    const wasDownloaded = await invoke<boolean>('file_exists', { path: modelPath });
    if (!wasDownloaded) {
      throw new Error('Model files not found after download');
    }
    
    // Add to installed models
    await addInstalledModel(modelName);
    
    onProgress({
      modelName,
      status: 'complete',
      progress: 1,
      message: 'Download complete!',
    });
    
    return {
      success: true,
      data: modelPath,
    };
  } catch (error) {
    logger.error('ModelManager', 'Model download failed', error);
    
    onProgress({
      modelName,
      status: 'failed',
      progress: 0,
      message: 'Download failed',
    });
    
    const categorized = errorService.categorize(error);
    return {
      success: false,
      error: categorized.userMessage,
      errorDetails: categorized,
    };
  }
}

/**
 * Delete model from disk
 */
export async function deleteModel(modelName: string): Promise<APIResponse<void>> {
  try {
    const modelPath = await getModelPath(modelName);
    
    // Check if model exists
    const modelExists = await invoke<boolean>('file_exists', { path: modelPath });
    if (!modelExists) {
      return {
        success: false,
        error: 'Model not found',
      };
    }
    
    // Delete model directory using the Tauri delete_directory command
    // (which uses std::fs::remove_dir_all — works cross-platform without
    // relying on shell built-ins like rmdir that cannot be spawned as a
    // standalone process on Windows)
    await invoke('delete_directory', { path: modelPath });
    
    // Remove from installed models
    await removeInstalledModel(modelName);
    
    logger.info('ModelManager', `Deleted model: ${modelName}`);
    
    return { success: true };
  } catch (error) {
    logger.error('ModelManager', 'Failed to delete model', error);
    const categorized = errorService.categorize(error);
    return {
      success: false,
      error: categorized.userMessage,
      errorDetails: categorized,
    };
  }
}

/**
 * Get list of installed models with metadata
 */
export async function getInstalledModelsInfo(): Promise<InstalledModelInfo[]> {
  try {
    const installedNames = await getInstalledModels();
    const modelsInfo: InstalledModelInfo[] = [];
    
    for (const name of installedNames) {
      const metadata = getModelById(name);
      if (!metadata) continue;
      
      const path = await getModelPath(name);
      
      // Check if model still exists on disk
      const modelExists = await invoke<boolean>('file_exists', { path });
      if (!modelExists) {
        // Remove from config if not found
        await removeInstalledModel(name);
        continue;
      }
      
      // Get model size (approximate)
      const size = metadata.estimatedSize * 1024 * 1024; // Convert MB to bytes
      
      modelsInfo.push({
        name,
        path,
        size,
        metadata,
      });
    }
    
    return modelsInfo;
  } catch (error) {
    logger.error('ModelManager', 'Failed to get installed models', error);
    return [];
  }
}

/**
 * Validate model integrity
 */
export async function validateModel(modelName: string): Promise<APIResponse<boolean>> {
  try {
    const modelPath = await getModelPath(modelName);
    
    // Check if model directory exists
    const modelExists = await invoke<boolean>('file_exists', { path: modelPath });
    if (!modelExists) {
      return {
        success: false,
        error: 'Model directory not found',
      };
    }
    
    // Check for required files (config.json and model.bin are typical)
    const configPath = `${modelPath}/config.json`;
    const hasConfig = await invoke<boolean>('file_exists', { path: configPath });
    
    if (!hasConfig) {
      return {
        success: false,
        error: 'Model configuration file missing',
      };
    }
    
    return {
      success: true,
      data: true,
    };
  } catch (error) {
    const categorized = errorService.categorize(error);
    return {
      success: false,
      error: categorized.userMessage,
      errorDetails: categorized,
    };
  }
}

/**
 * Get model size on disk
 */
export async function getModelSize(modelName: string): Promise<number> {
  try {
    const modelPath = await getModelPath(modelName);
    
    const modelExists = await invoke<boolean>('file_exists', { path: modelPath });
    if (!modelExists) {
      return 0;
    }
    
    // Use Tauri command to get directory size
    const size = await invoke<number>('get_directory_size', {
      path: modelPath,
    });
    
    return size;
  } catch (error) {
    logger.error('ModelManager', 'Failed to get model size', error);
    return 0;
  }
}

/**
 * Clean up incomplete downloads
 */
export async function cleanupIncompleteDownloads(): Promise<void> {
  try {
    const installedNames = await getInstalledModels();
    
    for (const name of installedNames) {
      const isValid = await validateModel(name);
      
      if (!isValid.success) {
        logger.info('ModelManager', `Cleaning up invalid model: ${name}`);
        await deleteModel(name);
      }
    }
  } catch (error) {
    logger.error('ModelManager', 'Failed to cleanup incomplete downloads', error);
  }
}
