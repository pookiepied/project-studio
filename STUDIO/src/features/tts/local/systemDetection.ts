/**
 * Minimal system detection for Edge TTS — just needs a usable Python 3.
 * (No GPU probing: Edge TTS is a thin client for Microsoft's cloud voice
 * service, unlike Faster Whisper it does no local inference.)
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/core/logging/logger';

export interface EdgeTtsSystemInfo {
  hasPython: boolean;
  pythonVersion?: string;
  pythonPath?: string;
}

export async function detectPython(): Promise<EdgeTtsSystemInfo> {
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
          return { hasPython: true, pythonVersion: version, pythonPath: command };
        }
      }
    } catch {
      continue;
    }
  }

  logger.debug('EdgeTtsSystemDetection', 'No usable Python 3 installation found');
  return { hasPython: false };
}
