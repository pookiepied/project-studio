/**
 * Parakeet-TDT Installation Service
 * Creates a venv, installs the ONNX runtime + `onnx-asr` (which pulls the
 * Parakeet-TDT 0.6B v2 ONNX export from Hugging Face on first load), and
 * pre-warms the model download so first-use transcription isn't the moment
 * a ~1-2GB download kicks in.
 *
 * We never bundle Python or a Python runtime — same approach as every other
 * local engine here: build a venv on top of the user's system Python.
 *
 * CPU-only by design. We initially added CUDA support (onnxruntime-gpu +
 * the nvidia-*-cu12 pip wheels needed to supply the CUDA/cuDNN runtime DLLs
 * onnxruntime-gpu doesn't bundle on Windows), and it did work — but a direct
 * benchmark on the same audio clip showed CPU inference at 0.64s vs 8-9s on
 * CUDA, consistently, even with the model already warm. Parakeet-TDT's
 * transducer decoder runs many small sequential steps (per-token decode +
 * joiner calls), and each one pays GPU kernel-launch/host-device sync
 * overhead that dwarfs the compute savings at batch size 1. That's a
 * property of the model/backend, not this machine's GPU, so there's no
 * upside to carrying the CUDA install path (five extra pip packages, ~1.3GB
 * of downloads, DLL search-path hacks, an onnxruntime-gpu version pin) for
 * a path that would make things worse for anyone who used it.
 */

import { invoke } from '@tauri-apps/api/core';
import { APIResponse } from '@/types';
import { errorService } from '@/core/errors/errorService';
import { logger } from '@/core/logging/logger';
import { getVenvDir, getVenvPythonPath, getScriptsDir, getModelsDir, markInstalled, markModelDownloaded } from './config';
import { detectSystemCapabilities } from './systemDetection';

export interface InstallationProgress {
  step: 'checking' | 'creating_venv' | 'installing_deps' | 'downloading_model' | 'writing_scripts' | 'complete';
  message: string;
  progress: number; // 0-1
}

export interface InstallationResult {
  pythonPath: string;
  pythonVersion: string;
}

export const MODEL_NAME = 'nemo-parakeet-tdt-0.6b-v2';

const TRANSCRIBE_SCRIPT = `#!/usr/bin/env python3
"""
Parakeet-TDT transcription script (ONNX runtime, via the onnx-asr package).

Decodes whatever audio container the recorder captured (webm/opus, wav, ...)
with PyAV — which bundles its own ffmpeg libraries, so no system ffmpeg
install is required — resamples to 16kHz mono, then runs Parakeet-TDT 0.6B
(English + ~25 European languages, notably resistant to hallucinating on
silence, unlike the Whisper family). CPU-only: benchmarked faster than CUDA
for this model's sequential decoder (see installationService.ts).
"""
import sys
import json

MODEL_NAME = "${MODEL_NAME}"


def load_audio_mono16k(path):
    import av
    import numpy as np

    container = av.open(path)
    stream = next(s for s in container.streams if s.type == "audio")
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)

    chunks = []
    for frame in container.decode(stream):
        for rframe in resampler.resample(frame):
            arr = rframe.to_ndarray()
            if arr.size:
                chunks.append(arr)
    container.close()

    if not chunks:
        return np.zeros(0, dtype=np.float32)

    pcm16 = np.concatenate(chunks, axis=1).reshape(-1)
    return pcm16.astype(np.float32) / 32768.0


def load_model(models_dir):
    import os
    # Must be set before onnx_asr (which imports huggingface_hub) is imported —
    # the cache root is resolved at import time. Keeps the downloaded model
    # under our own addon directory instead of the user's global HF cache.
    os.environ["HF_HOME"] = models_dir
    import onnx_asr

    return onnx_asr.load_model(MODEL_NAME)


def recognize(model, waveform):
    # onnx-asr's call signature has shifted across versions — try the
    # reasonable variants instead of betting on exactly one.
    try:
        return model.recognize(waveform, sample_rate=16000)
    except TypeError:
        pass
    try:
        return model.recognize(waveform)
    except TypeError:
        result = model.recognize([waveform])
        return result[0] if isinstance(result, list) else result


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Invalid arguments"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    models_dir = sys.argv[2]

    try:
        waveform = load_audio_mono16k(audio_path)
        if waveform.size == 0:
            print(json.dumps({"success": False, "error": "No audio decoded from input file"}))
            sys.exit(1)

        model = load_model(models_dir)
        result = recognize(model, waveform)
        text = result if isinstance(result, str) else getattr(result, "text", str(result))

        print(json.dumps({"success": True, "text": text.strip()}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "error_type": type(e).__name__}))
        sys.exit(1)


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

  // Avoid guessing at extras syntax (package extras change across releases) —
  // install the base package plus its known runtime deps explicitly instead.
  await invoke('execute_shell_command', {
    command: pythonPath,
    args: ['-m', 'pip', 'install', 'onnx-asr', 'huggingface_hub', 'onnxruntime', 'av', '--no-cache-dir'],
  });

  await invoke('execute_shell_command', {
    command: pythonPath,
    args: ['-c', 'import onnx_asr, av; print("OK")'],
  });
}

async function writeTranscribeScript(): Promise<void> {
  const scriptsDir = await getScriptsDir();
  await invoke('write_text_file', {
    path: `${scriptsDir}/transcribe.py`,
    content: TRANSCRIBE_SCRIPT,
  });
}

async function downloadModel(): Promise<void> {
  const pythonPath = await getVenvPythonPath();
  const modelsDir = await getModelsDir();
  // Forces onnx-asr to pull + cache the ONNX model files now (into our own
  // addon directory, not the user's global HF cache — see getModelsDir),
  // so the first real transcription isn't also the moment a large download
  // kicks in.
  await invoke('execute_shell_command', {
    command: pythonPath,
    args: [
      '-c',
      `import os; os.environ["HF_HOME"] = ${JSON.stringify(modelsDir)}; import onnx_asr; onnx_asr.load_model(${JSON.stringify(MODEL_NAME)}); print("OK")`,
    ],
  });
  await markModelDownloaded();
}

/**
 * Install Parakeet-TDT: create venv, install onnx-asr + onnxruntime + av,
 * write the transcription script, and pre-warm the model download.
 */
export async function installParakeet(
  onProgress: (progress: InstallationProgress) => void
): Promise<APIResponse<InstallationResult>> {
  try {
    onProgress({ step: 'checking', message: 'Checking system capabilities...', progress: 0 });

    const systemInfo = await detectSystemCapabilities();
    if (!systemInfo.hasPython) {
      const categorized = errorService.categorize('Python 3.9+ not found. Please install Python.');
      return { success: false, error: categorized.userMessage, errorDetails: categorized };
    }

    onProgress({ step: 'creating_venv', message: 'Creating virtual environment...', progress: 0.15 });
    await createVirtualEnvironment(systemInfo.pythonPath!);

    onProgress({ step: 'installing_deps', message: 'Installing onnx-asr...', progress: 0.35 });
    await installDependencies();

    onProgress({ step: 'writing_scripts', message: 'Writing transcription script...', progress: 0.6 });
    await writeTranscribeScript();

    onProgress({
      step: 'downloading_model',
      message: 'Downloading Parakeet-TDT model (first run only, may take a few minutes)...',
      progress: 0.7,
    });
    await downloadModel();

    await markInstalled(systemInfo.pythonPath!, systemInfo.pythonVersion!);

    onProgress({ step: 'complete', message: 'Installation complete!', progress: 1 });

    return {
      success: true,
      data: { pythonPath: systemInfo.pythonPath!, pythonVersion: systemInfo.pythonVersion! },
    };
  } catch (error) {
    logger.error('ParakeetInstallation', 'Installation failed', error);
    const categorized = errorService.categorize(error);
    return { success: false, error: categorized.userMessage, errorDetails: categorized };
  }
}
