/**
 * Edge TTS Installation Service
 * Creates a dedicated venv and installs the `edge-tts` package.
 * We never bundle Python or a Python runtime with the app — this mirrors
 * Faster Whisper's approach of creating a venv on top of the user's system
 * Python at install time (see fasterWhisper/installationService.ts).
 */

import { invoke } from '@tauri-apps/api/core';
import { APIResponse } from '@/types';
import { errorService } from '@/core/errors/errorService';
import { logger } from '@/core/logging/logger';
import { getVenvDir, getVenvPythonPath, getScriptsDir, markInstalled } from './config';
import { detectPython } from './systemDetection';

export interface InstallationProgress {
  step: 'checking' | 'creating_venv' | 'installing_deps' | 'writing_scripts' | 'complete';
  message: string;
  progress: number; // 0-1
}

export interface InstallationResult {
  pythonPath: string;
  pythonVersion: string;
}

const SPEAK_SCRIPT = `#!/usr/bin/env python3
"""
Edge TTS synthesis script.
Reads base64-encoded UTF-8 text + a voice id (and optional rate) from argv,
synthesizes speech with edge-tts, and prints a JSON envelope containing the
resulting mp3 as base64 on stdout. Keeping request/response entirely on
stdin/argv + stdout avoids needing extra Tauri commands for binary I/O.
"""
import sys
import json
import base64
import asyncio
import tempfile
import os

import edge_tts


async def _synthesize(text: str, voice: str, rate: str, out_path: str) -> None:
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    with open(out_path, "wb") as audio_file:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_file.write(chunk["data"])


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Invalid arguments"}))
        sys.exit(1)

    text_b64, voice = sys.argv[1], sys.argv[2]
    rate = sys.argv[3] if len(sys.argv) > 3 else "+0%"

    try:
        text = base64.b64decode(text_b64).decode("utf-8")
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Invalid text payload: {e}"}))
        sys.exit(1)

    if not text.strip():
        print(json.dumps({"success": False, "error": "Empty text"}))
        sys.exit(1)

    fd, out_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)

    try:
        asyncio.run(_synthesize(text, voice, rate, out_path))
        with open(out_path, "rb") as audio_file:
            audio_b64 = base64.b64encode(audio_file.read()).decode("ascii")
        print(json.dumps({"success": True, "audio_base64": audio_b64}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "error_type": type(e).__name__}))
        sys.exit(1)
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)


if __name__ == "__main__":
    main()
`;

async function createVirtualEnvironment(pythonPath: string): Promise<void> {
  const venvDir = await getVenvDir();

  await invoke('execute_shell_command', {
    command: pythonPath,
    args: ['-m', 'venv', venvDir],
  });

  const venvPythonPath = await getVenvPythonPath();
  const venvExists = await invoke<boolean>('file_exists', { path: venvPythonPath });
  if (!venvExists) {
    throw new Error('Virtual environment was not created successfully');
  }
}

async function installDependencies(): Promise<void> {
  const pythonPath = await getVenvPythonPath();

  await invoke('execute_shell_command', {
    command: pythonPath,
    args: ['-m', 'pip', 'install', '--upgrade', 'pip'],
  });

  await invoke('execute_shell_command', {
    command: pythonPath,
    args: ['-m', 'pip', 'install', 'edge-tts', '--no-cache-dir'],
  });

  // Verify import works
  await invoke('execute_shell_command', {
    command: pythonPath,
    args: ['-c', 'import edge_tts; print("OK")'],
  });
}

async function writeSpeakScript(): Promise<void> {
  const scriptsDir = await getScriptsDir();
  await invoke('write_text_file', {
    path: `${scriptsDir}/speak.py`,
    content: SPEAK_SCRIPT,
  });
}

/**
 * Install Edge TTS: create venv, install `edge-tts`, write the synthesis script.
 */
export async function installEdgeTts(
  onProgress: (progress: InstallationProgress) => void
): Promise<APIResponse<InstallationResult>> {
  try {
    onProgress({ step: 'checking', message: 'Checking system capabilities...', progress: 0 });

    const systemInfo = await detectPython();
    if (!systemInfo.hasPython) {
      const categorized = errorService.categorize('Python 3.9+ not found. Please install Python.');
      return { success: false, error: categorized.userMessage, errorDetails: categorized };
    }

    onProgress({ step: 'creating_venv', message: 'Creating virtual environment...', progress: 0.2 });
    await createVirtualEnvironment(systemInfo.pythonPath!);

    onProgress({ step: 'installing_deps', message: 'Installing edge-tts...', progress: 0.5 });
    await installDependencies();

    onProgress({ step: 'writing_scripts', message: 'Writing synthesis script...', progress: 0.9 });
    await writeSpeakScript();

    await markInstalled(systemInfo.pythonPath!, systemInfo.pythonVersion!);

    onProgress({ step: 'complete', message: 'Installation complete!', progress: 1 });

    return {
      success: true,
      data: { pythonPath: systemInfo.pythonPath!, pythonVersion: systemInfo.pythonVersion! },
    };
  } catch (error) {
    logger.error('EdgeTtsInstallation', 'Installation failed', error);
    const categorized = errorService.categorize(error);
    return { success: false, error: categorized.userMessage, errorDetails: categorized };
  }
}
