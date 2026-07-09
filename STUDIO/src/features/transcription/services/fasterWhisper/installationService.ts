/**
 * Faster Whisper Installation Service
 * Handles Python virtual environment creation and dependency installation
 */

import { invoke } from '@tauri-apps/api/core';
import { APIResponse } from '@/types';
import { errorService } from '@/core/errors/errorService';
import { logger } from '@/core/logging/logger';
import { 
  getVenvDir, 
  getVenvPythonPath,
  getScriptsDir,
  markInstalled 
} from './config';
import { detectSystemCapabilities, getRecommendedDevice } from './systemDetection';

export interface InstallationProgress {
  step: 'checking' | 'creating_venv' | 'installing_deps' | 'writing_scripts' | 'complete';
  message: string;
  progress: number; // 0-1
  package?: string;
}

export interface InstallationResult {
  success: boolean;
  pythonPath: string;
  pythonVersion: string;
  device: 'cuda' | 'cpu';
}

/**
 * Check if virtual environment exists
 */
export async function checkVenvExists(): Promise<boolean> {
  try {
    const pythonPath = await getVenvPythonPath();
    return await invoke<boolean>('file_exists', { path: pythonPath });
  } catch {
    return false;
  }
}

/**
 * Create virtual environment
 */
async function createVirtualEnvironment(
  pythonPath: string,
  onProgress: (progress: InstallationProgress) => void
): Promise<void> {
  onProgress({
    step: 'creating_venv',
    message: 'Creating virtual environment...',
    progress: 0.1,
  });
  
  try {
    const venvDir = await getVenvDir();
    
    // Create venv using python -m venv
    await invoke('execute_shell_command', {
      command: pythonPath,
      args: ['-m', 'venv', venvDir],
    });
    
    // Verify venv was created successfully
    const venvPythonPath = await getVenvPythonPath();
    const venvExists = await invoke<boolean>('file_exists', { path: venvPythonPath });
    
    if (!venvExists) {
      throw new Error('Virtual environment was not created successfully');
    }
    
    logger.info('Installation', 'Virtual environment created', {
      venvDir,
      pythonPath: venvPythonPath
    });
  } catch (error) {
    logger.error('Installation', 'Failed to create virtual environment', error);
    throw new Error(`Failed to create virtual environment: ${error}`);
  }
}

/**
 * Install Python dependencies with real-time progress
 */
async function installDependencies(
  device: 'cuda' | 'cpu',
  onProgress: (progress: InstallationProgress) => void
): Promise<void> {
  const pythonPath = await getVenvPythonPath();
  
  // Define packages to install
  const basePackages = [
    'faster-whisper==1.2.1',
    'ctranslate2==4.6.2',
    'huggingface-hub',
  ];
  
  // GPU packages - use the original CUDA packages for best performance
  const gpuPackages = [
    'nvidia-cuda-runtime-cu12==12.8.90',
    'nvidia-cublas-cu12==12.8.4.1',
    'nvidia-cudnn-cu12==9.10.2.21',
  ];
  
  onProgress({
    step: 'installing_deps',
    message: 'Upgrading pip...',
    progress: 0.2,
  });
  
  try {
    // Upgrade pip first
    await invoke('execute_shell_command', {
      command: pythonPath,
      args: ['-m', 'pip', 'install', '--upgrade', 'pip'],
    });
    
    if (device === 'cuda') {
      // Install GPU packages first with progress
      onProgress({
        step: 'installing_deps',
        message: 'Installing NVIDIA CUDA packages (this will show download progress)...',
        progress: 0.3,
        package: 'CUDA packages',
      });
      
      // Listen for pip progress events
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen('pip-progress', (event) => {
        const line = event.payload as string;
        logger.debug('Installation', 'Pip progress', line);
        
        // Parse pip progress output
        if (line.includes('Downloading') || line.includes('Installing')) {
          onProgress({
            step: 'installing_deps',
            message: line,
            progress: 0.3,
            package: 'CUDA packages',
          });
        }
      });
      
      try {
        // Install GPU packages with progress
        for (const pkg of gpuPackages) {
          const pkgName = pkg.split('==')[0];
          onProgress({
            step: 'installing_deps',
            message: `Installing ${pkgName}...`,
            progress: 0.3,
            package: pkgName,
          });
          
          await invoke('execute_pip_with_progress', {
            pythonPath,
            args: ['install', pkg, '--no-cache-dir', '--progress-bar', 'on'],
          });
        }
      } finally {
        unlisten();
      }
      
      // Install base packages
      onProgress({
        step: 'installing_deps',
        message: 'Installing base packages...',
        progress: 0.7,
        package: 'base packages',
      });
      
      await invoke('execute_shell_command', {
        command: pythonPath,
        args: ['-m', 'pip', 'install', ...basePackages, '--no-cache-dir'],
      });
    } else {
      // CPU-only installation
      onProgress({
        step: 'installing_deps',
        message: 'Installing packages for CPU...',
        progress: 0.4,
        package: 'cpu packages',
      });
      
      await invoke('execute_shell_command', {
        command: pythonPath,
        args: ['-m', 'pip', 'install', ...basePackages, '--no-cache-dir'],
      });
    }
    
    onProgress({
      step: 'installing_deps',
      message: 'Verifying installation...',
      progress: 0.9,
    });
    
    // Quick verification that faster-whisper can be imported
    await invoke('execute_shell_command', {
      command: pythonPath,
      args: ['-c', 'import faster_whisper; print("OK")'],
    });
    
    logger.info('Installation', 'All dependencies installed and verified');
  } catch (error) {
    logger.error('Installation', 'Failed to install dependencies', error);
    throw new Error(`Failed to install dependencies: ${error}`);
  }
}

/**
 * Write Python scripts to disk
 */
async function writePythonScripts(
  onProgress: (progress: InstallationProgress) => void
): Promise<void> {
  onProgress({
    step: 'writing_scripts',
    message: 'Writing Python scripts...',
    progress: 0.85,
  });
  
  try {
    const scriptsDir = await getScriptsDir();
    
    // Write transcribe.py
    const transcribeScript = `#!/usr/bin/env python3
"""
Faster Whisper transcription script
"""
import sys
import json
from pathlib import Path

# Import CUDA setup first (if available)
try:
    import cuda_setup
except ImportError:
    pass  # CUDA setup not available, continue anyway

from faster_whisper import WhisperModel

def transcribe(audio_file, model_path, device, compute_type, task="transcribe"):
    try:
        model = WhisperModel(model_path, device=device, compute_type=compute_type)
        segments, info = model.transcribe(audio_file, task=task, language=None, beam_size=5, vad_filter=True)
        
        text_parts = []
        for segment in segments:
            text_parts.append(segment.text.strip())
        
        full_text = "\\n".join(text_parts)
        
        result = {
            "success": True,
            "text": full_text,
            "language": info.language,
            "duration": info.duration,
        }
        
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 6:
        print(json.dumps({"success": False, "error": "Invalid arguments"}))
        sys.exit(1)
    
    transcribe(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
`;
    
    await invoke('write_text_file', { 
      path: `${scriptsDir}/transcribe.py`, 
      content: transcribeScript 
    });
    
    // Write download_model.py
    const downloadScript = `#!/usr/bin/env python3
"""
Download Faster Whisper model from HuggingFace
"""
import sys
import json
from huggingface_hub import snapshot_download

def download_model(model_name, output_dir):
    try:
        repo_id = f"Systran/faster-whisper-{model_name}"
        path = snapshot_download(repo_id=repo_id, local_dir=output_dir, local_dir_use_symlinks=False)
        print(json.dumps({"success": True, "path": str(path)}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Invalid arguments"}))
        sys.exit(1)
    download_model(sys.argv[1], sys.argv[2])
`;
    
    await invoke('write_text_file', { 
      path: `${scriptsDir}/download_model.py`, 
      content: downloadScript 
    });
    
    logger.info('Installation', 'Python scripts written');
  } catch (error) {
    logger.error('Installation', 'Failed to write Python scripts', error);
    throw new Error(`Failed to write Python scripts: ${error}`);
  }
}

/**
 * Install Faster Whisper
 * Creates virtual environment and installs dependencies
 */
export async function installFasterWhisper(
  onProgress: (progress: InstallationProgress) => void
): Promise<APIResponse<InstallationResult>> {
  try {
    onProgress({
      step: 'checking',
      message: 'Checking system capabilities...',
      progress: 0,
    });
    
    // Detect system capabilities
    const systemInfo = await detectSystemCapabilities();
    
    if (!systemInfo.hasPython) {
      const categorized = errorService.categorize('Python 3.11+ not found. Please install Python.');
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
    
    // Use GPU if available, otherwise CPU
    const device = getRecommendedDevice(systemInfo);
    
    logger.info('Installation', `Installing for ${device.toUpperCase()} mode`);
    
    // Create virtual environment
    await createVirtualEnvironment(systemInfo.pythonPath!, onProgress);
    
    // Install dependencies
    await installDependencies(device, onProgress);
    
    // Write Python scripts
    await writePythonScripts(onProgress);
    
    // Set up CUDA paths if GPU mode
    if (device === 'cuda') {
      onProgress({
        step: 'writing_scripts',
        message: 'Configuring CUDA paths...',
        progress: 0.92,
      });
      
      const { setupCUDAPaths } = await import('./cudaSetup');
      const cudaResult = await setupCUDAPaths();
      
      if (cudaResult.success) {
        logger.info('Installation', 'CUDA paths configured', cudaResult.message);
      } else {
        logger.warn('Installation', 'CUDA setup warning', cudaResult.message);
        // Don't fail installation, just warn
      }
    }
    
    // Mark as installed
    await markInstalled(systemInfo.pythonPath!, systemInfo.pythonVersion!, device);
    
    onProgress({
      step: 'complete',
      message: 'Installation complete!',
      progress: 1,
    });
    
    return {
      success: true,
      data: {
        success: true,
        pythonPath: systemInfo.pythonPath!,
        pythonVersion: systemInfo.pythonVersion!,
        device,
      },
    };
  } catch (error) {
    logger.error('Installation', 'Installation failed', error);
    const categorized = errorService.categorize(error);
    return {
      success: false,
      error: categorized.userMessage,
      errorDetails: categorized,
    };
  }
}

/**
 * Verify installation integrity
 */
export async function verifyInstallation(): Promise<APIResponse<boolean>> {
  try {
    // Check if venv exists
    const venvExists = await checkVenvExists();
    if (!venvExists) {
      return {
        success: false,
        error: 'Virtual environment not found',
      };
    }
    
    // Try to import faster_whisper
    const pythonPath = await getVenvPythonPath();
    const result = await invoke<string>('execute_shell_command', {
      command: pythonPath,
      args: ['-c', 'import faster_whisper; print("OK")'],
    });
    
    if (result.includes('OK')) {
      return { success: true, data: true };
    }
    
    return {
      success: false,
      error: 'Faster Whisper not properly installed',
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
