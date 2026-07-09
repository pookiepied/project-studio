/**
 * Faster Whisper Transcription Service
 * Handles audio transcription using local Faster Whisper models
 */

import { invoke } from '@tauri-apps/api/core';
import { APIResponse } from '@/types';
import { errorService } from '@/core/errors/errorService';
import { logger } from '@/core/logging/logger';
import { 
  loadConfig, 
  getVenvPythonPath, 
  getScriptsDir,
  setSelectedModel 
} from './config';
import { getModelPath, isModelDownloaded } from './modelManager';
import { getRecommendedQuantization } from './systemDetection';

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
}

export interface TranscriptionOptions {
  modelName?: string;
  task?: 'transcribe' | 'translate';
  device?: 'cuda' | 'cpu';
  computeType?: string;
}

/**
 * Transcribe audio file using Faster Whisper
 */
export async function transcribeWithFasterWhisper(
  audioFilePath: string,
  options: TranscriptionOptions = {}
): Promise<APIResponse<TranscriptionResult>> {
  try {
    // Load config
    const config = await loadConfig();
    
    if (!config.installed) {
      const categorized = errorService.categorize('Faster Whisper not installed');
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
    
    // Determine model to use
    const modelName = options.modelName || config.selectedModel;
    if (!modelName) {
      const categorized = errorService.categorize('No model selected');
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
    
    // Check if model is downloaded
    const isDownloaded = await isModelDownloaded(modelName);
    if (!isDownloaded) {
      const categorized = errorService.categorize(`Model ${modelName} not downloaded`);
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
    
    // Get paths
    const pythonPath = await getVenvPythonPath();
    const scriptsDir = await getScriptsDir();
    const modelPath = await getModelPath(modelName);
    
    // Determine device and compute type
    const device = options.device || config.device;
    const computeType = options.computeType || config.quantization || getRecommendedQuantization(device);
    const task = options.task || 'transcribe';
    
    logger.info('Transcription', 'Starting transcription', {
      model: modelName,
      device,
      computeType,
      task,
    });
    
    // Execute transcription script
    const result = await invoke<string>('execute_shell_command', {
      command: pythonPath,
      args: [
        `${scriptsDir}/transcribe.py`,
        audioFilePath,
        modelPath,
        device,
        computeType,
        task,
      ],
    });
    
    // Parse result
    const parsed = JSON.parse(result);
    
    if (!parsed.success) {
      throw new Error(parsed.error || 'Transcription failed');
    }
    
    // Update last used
    await setSelectedModel(modelName);
    
    logger.info('Transcription', 'Transcription complete', {
      language: parsed.language,
      duration: parsed.duration,
      textLength: parsed.text.length,
    });
    
    return {
      success: true,
      data: {
        text: parsed.text,
        language: parsed.language,
        duration: parsed.duration,
      },
    };
  } catch (error) {
    logger.error('Transcription', 'Transcription failed', error);
    const categorized = errorService.categorize(error);
    return {
      success: false,
      error: categorized.userMessage,
      errorDetails: categorized,
    };
  }
}

/**
 * Check if Faster Whisper is ready for transcription
 */
export async function isFasterWhisperReady(): Promise<boolean> {
  try {
    const config = await loadConfig();
    
    if (!config.installed) {
      return false;
    }
    
    if (!config.selectedModel) {
      return false;
    }
    
    const isDownloaded = await isModelDownloaded(config.selectedModel);
    return isDownloaded;
  } catch {
    return false;
  }
}

/**
 * Get transcription status
 */
export async function getTranscriptionStatus(): Promise<{
  ready: boolean;
  installed: boolean;
  hasModel: boolean;
  selectedModel?: string;
  device: 'cuda' | 'cpu';
}> {
  try {
    const config = await loadConfig();
    const hasModel = config.selectedModel ? await isModelDownloaded(config.selectedModel) : false;
    
    return {
      ready: config.installed && hasModel,
      installed: config.installed,
      hasModel,
      selectedModel: config.selectedModel,
      device: config.device,
    };
  } catch {
    return {
      ready: false,
      installed: false,
      hasModel: false,
      device: 'cpu',
    };
  }
}
