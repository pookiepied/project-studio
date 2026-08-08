/**
 * Parakeet-TDT Transcription Service
 * Same one-shot subprocess-per-call pattern as the rest of this app's local
 * engines: run the venv's transcribe.py once per recording.
 */

import { invoke } from '@tauri-apps/api/core';
import { APIResponse } from '@/types';
import { errorService } from '@/core/errors/errorService';
import { logger } from '@/core/logging/logger';
import { loadConfig, getVenvPythonPath, getScriptsDir, getModelsDir } from './config';

export interface TranscriptionResult {
  text: string;
}

export async function transcribeWithParakeet(audioFilePath: string): Promise<APIResponse<TranscriptionResult>> {
  try {
    const config = await loadConfig();
    if (!config.installed) {
      const categorized = errorService.categorize('Parakeet is not installed');
      return { success: false, error: categorized.userMessage, errorDetails: categorized };
    }

    const pythonPath = await getVenvPythonPath();
    const scriptsDir = await getScriptsDir();
    const modelsDir = await getModelsDir();

    logger.info('ParakeetTranscription', 'Starting transcription');

    const result = await invoke<string>('execute_shell_command', {
      command: pythonPath,
      args: [`${scriptsDir}/transcribe.py`, audioFilePath, modelsDir],
    });

    const parsed = JSON.parse(result);
    if (!parsed.success) {
      throw new Error(parsed.error || 'Transcription failed');
    }

    logger.info('ParakeetTranscription', 'Transcription complete', { textLength: parsed.text.length });

    return { success: true, data: { text: parsed.text } };
  } catch (error) {
    logger.error('ParakeetTranscription', 'Transcription failed', error);
    const categorized = errorService.categorize(error);
    return { success: false, error: categorized.userMessage, errorDetails: categorized };
  }
}
