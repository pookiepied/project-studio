/**
 * System detection for Parakeet — needs a usable Python 3. CPU-only: GPU
 * detection was removed after benchmarking showed CUDA is actually *slower*
 * than CPU for this model (see installationService.ts for the numbers).
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/core/logging/logger';

export interface ParakeetSystemInfo {
  hasPython: boolean;
  pythonVersion?: string;
  pythonPath?: string;
}

async function detectPython(): Promise<{ available: boolean; version?: string; path?: string }> {
  const commands = ['python3', 'python'];

  for (const command of commands) {
    try {
      const result = await invoke<string>('execute_shell_command', {
        command,
        args: ['--version'],
      });

      const versionMatch = result.match(/Python (\d+\.\d+\.\d+)/);
      if (versionMatch) {
        const version = versionMatch[1];
        const [major, minor] = version.split('.').map(Number);
        if (major === 3 && minor >= 9) {
          return { available: true, version, path: command };
        }
      }
    } catch {
      continue;
    }
  }

  return { available: false };
}

export async function detectSystemCapabilities(): Promise<ParakeetSystemInfo> {
  try {
    const pythonInfo = await detectPython();

    return {
      hasPython: pythonInfo.available,
      pythonVersion: pythonInfo.version,
      pythonPath: pythonInfo.path,
    };
  } catch (error) {
    logger.error('ParakeetSystemDetection', 'System detection failed', error);
    return { hasPython: false };
  }
}
