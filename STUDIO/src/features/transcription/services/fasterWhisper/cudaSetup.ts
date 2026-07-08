/**
 * CUDA Setup Service
 * Configures CUDA library paths for Faster Whisper
 * 
 * Based on the reference implementation from Faster-Whisper-Transcriber
 * This ensures that CUDA DLLs installed via pip are accessible to ctranslate2
 */

import { invoke } from '@tauri-apps/api/core';
import { getVenvDir } from './config';
import { logger } from '@/services/logging/logger';

interface CUDAPathsResult {
  success: boolean;
  paths: string[];
  message: string;
}

/**
 * Get the nvidia packages directory in the virtual environment
 */
async function getNvidiaBasePath(): Promise<string | null> {
  try {
    const venvDir = await getVenvDir();
    
    // On Windows: venv/Lib/site-packages/nvidia
    // On Linux/Mac: venv/lib/python3.x/site-packages/nvidia
    const isWindows = navigator.platform.toLowerCase().includes('win');
    
    let nvidiaPath: string;
    if (isWindows) {
      nvidiaPath = `${venvDir}/Lib/site-packages/nvidia`;
    } else {
      // For Linux/Mac, we need to detect Python version
      // For now, assume Python 3.11 (can be made dynamic)
      nvidiaPath = `${venvDir}/lib/python3.11/site-packages/nvidia`;
    }
    
    // Check if nvidia directory exists
    const exists = await invoke<boolean>('file_exists', { path: nvidiaPath });
    
    if (exists) {
      logger.info('CUDASetup', 'Found nvidia packages', { path: nvidiaPath });
      return nvidiaPath;
    }
    
    logger.debug('CUDASetup', 'Nvidia packages not found', { searchPath: nvidiaPath });
    return null;
  } catch (error) {
    logger.error('CUDASetup', 'Error finding nvidia base path', error);
    return null;
  }
}

/**
 * Get library paths for Windows
 */
function getWindowsLibraryPaths(nvidiaBase: string): string[] {
  return [
    `${nvidiaBase}/cuda_runtime/bin`,
    `${nvidiaBase}/cuda_runtime/lib/x64`,
    `${nvidiaBase}/cuda_runtime/include`,
    `${nvidiaBase}/cublas/bin`,
    `${nvidiaBase}/cudnn/bin`,
    `${nvidiaBase}/cuda_nvrtc/bin`,
    `${nvidiaBase}/cuda_nvcc/bin`,
  ];
}

/**
 * Get library paths for Linux/Mac
 */
function getUnixLibraryPaths(nvidiaBase: string): string[] {
  return [
    `${nvidiaBase}/cuda_runtime/lib`,
    `${nvidiaBase}/cublas/lib`,
    `${nvidiaBase}/cudnn/lib`,
    `${nvidiaBase}/cuda_nvrtc/lib`,
  ];
}

/**
 * Check which library paths actually exist
 */
async function filterExistingPaths(paths: string[]): Promise<string[]> {
  const existingPaths: string[] = [];
  
  for (const path of paths) {
    try {
      const exists = await invoke<boolean>('file_exists', { path });
      if (exists) {
        existingPaths.push(path);
        logger.debug('CUDASetup', 'Found library path', { path });
      }
    } catch (error) {
      logger.warn('CUDASetup', 'Error checking path', { path, error });
    }
  }
  
  return existingPaths;
}

/**
 * Set up CUDA paths by creating a Python script that will be run before transcription
 * 
 * This script will:
 * 1. Find the nvidia packages in site-packages
 * 2. Add the DLL/library paths to PATH/LD_LIBRARY_PATH
 * 3. Set CUDA_PATH environment variable
 */
export async function setupCUDAPaths(): Promise<CUDAPathsResult> {
  try {
    logger.info('CUDASetup', 'Starting CUDA path configuration');
    
    // Find nvidia packages directory
    const nvidiaBase = await getNvidiaBasePath();
    
    if (!nvidiaBase) {
      return {
        success: false,
        paths: [],
        message: 'NVIDIA packages not found. CUDA packages may not be installed.',
      };
    }
    
    // Get platform-specific library paths
    const isWindows = navigator.platform.toLowerCase().includes('win');
    const libraryPaths = isWindows 
      ? getWindowsLibraryPaths(nvidiaBase)
      : getUnixLibraryPaths(nvidiaBase);
    
    // Filter to only existing paths
    const existingPaths = await filterExistingPaths(libraryPaths);
    
    if (existingPaths.length === 0) {
      return {
        success: false,
        paths: [],
        message: 'No CUDA library paths found. CUDA packages may be incomplete.',
      };
    }
    
    logger.info('CUDASetup', `Found ${existingPaths.length} CUDA library paths`);
    
    // Create a Python setup script that will be imported before transcription
    const setupScript = generateCUDASetupScript(nvidiaBase);
    
    // Write the setup script to the scripts directory
    const { getScriptsDir } = await import('./config');
    const scriptsDir = await getScriptsDir();
    const setupScriptPath = `${scriptsDir}/cuda_setup.py`;
    
    await invoke('write_text_file', {
      path: setupScriptPath,
      content: setupScript,
    });
    
    logger.info('CUDASetup', 'CUDA setup script written', { path: setupScriptPath });
    
    return {
      success: true,
      paths: existingPaths,
      message: `CUDA paths configured successfully. Found ${existingPaths.length} library paths.`,
    };
  } catch (error) {
    logger.error('CUDASetup', 'Failed to setup CUDA paths', error);
    return {
      success: false,
      paths: [],
      message: `Failed to setup CUDA paths: ${error}`,
    };
  }
}

/**
 * Generate Python script that sets up CUDA paths
 * This script will be imported at the start of transcription
 */
function generateCUDASetupScript(nvidiaBase: string): string {
  return `"""
CUDA Path Setup
Automatically configures CUDA library paths for Faster Whisper
"""
import os
import sys
from pathlib import Path

def setup_cuda_paths():
    """Configure CUDA library paths."""
    nvidia_base = Path(r"${nvidiaBase}")
    
    if not nvidia_base.exists():
        return False
    
    # Define library paths based on platform
    if sys.platform == "win32":
        library_paths = [
            nvidia_base / "cuda_runtime" / "bin",
            nvidia_base / "cuda_runtime" / "lib" / "x64",
            nvidia_base / "cublas" / "bin",
            nvidia_base / "cudnn" / "bin",
            nvidia_base / "cuda_nvrtc" / "bin",
        ]
        env_var = "PATH"
    else:
        library_paths = [
            nvidia_base / "cuda_runtime" / "lib",
            nvidia_base / "cublas" / "lib",
            nvidia_base / "cudnn" / "lib",
            nvidia_base / "cuda_nvrtc" / "lib",
        ]
        env_var = "LD_LIBRARY_PATH"
    
    # Filter to existing paths
    existing_paths = [str(p) for p in library_paths if p.exists()]
    
    if not existing_paths:
        return False
    
    # Add to environment variable
    current_value = os.environ.get(env_var, "")
    new_value = os.pathsep.join(existing_paths + ([current_value] if current_value else []))
    os.environ[env_var] = new_value
    
    # Set CUDA_PATH
    cuda_runtime = nvidia_base / "cuda_runtime"
    if cuda_runtime.exists():
        os.environ["CUDA_PATH"] = str(cuda_runtime)
    
    # For Windows, also use add_dll_directory (Python 3.8+)
    if sys.platform == "win32" and hasattr(os, "add_dll_directory"):
        for path in existing_paths:
            try:
                os.add_dll_directory(path)
            except OSError:
                pass
    
    return True

# Run setup when module is imported
_cuda_configured = setup_cuda_paths()
`;
}

/**
 * Check if CUDA is available and properly configured
 */
export async function checkCUDAAvailability(): Promise<boolean> {
  try {
    const { getVenvPythonPath } = await import('./config');
    const pythonPath = await getVenvPythonPath();
    
    // Try to check CUDA device count using ctranslate2
    const checkScript = `
import sys
try:
    import ctranslate2
    count = ctranslate2.get_cuda_device_count()
    print(f"CUDA_DEVICES:{count}")
    sys.exit(0)
except Exception as e:
    print(f"CUDA_ERROR:{e}")
    sys.exit(1)
`;
    
    const result = await invoke<string>('execute_shell_command', {
      command: pythonPath,
      args: ['-c', checkScript],
    });
    
    if (result.includes('CUDA_DEVICES:')) {
      const count = parseInt(result.split(':')[1]);
      logger.info('CUDASetup', 'CUDA devices found', { count });
      return count > 0;
    }
    
    logger.debug('CUDASetup', 'CUDA not available', { result });
    return false;
  } catch (error) {
    logger.error('CUDASetup', 'Error checking CUDA availability', error);
    return false;
  }
}

/**
 * Get CUDA device information
 */
export async function getCUDADeviceInfo(): Promise<string | null> {
  try {
    const { getVenvPythonPath } = await import('./config');
    const pythonPath = await getVenvPythonPath();
    
    const checkScript = `
import sys
try:
    import ctranslate2
    count = ctranslate2.get_cuda_device_count()
    if count > 0:
        print("NVIDIA GPU")
    else:
        print("No CUDA devices")
except Exception:
    print("CUDA not available")
`;
    
    const result = await invoke<string>('execute_shell_command', {
      command: pythonPath,
      args: ['-c', checkScript],
    });
    
    return result.trim();
  } catch (error) {
    logger.error('CUDASetup', 'Error getting CUDA device info', error);
    return null;
  }
}
