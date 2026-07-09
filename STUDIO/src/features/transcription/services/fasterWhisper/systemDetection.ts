/**
 * System Detection Service for Faster Whisper
 * Detects Python, GPU, and system capabilities
 */

import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/core/logging/logger';

export interface SystemInfo {
  hasPython: boolean;
  pythonVersion?: string;
  pythonPath?: string;
  hasNvidiaGPU: boolean;
  hasAMDGPU: boolean;
  gpuName?: string;
  platform: 'windows' | 'macos' | 'linux';
  architecture: string;
}

export interface GPUInfo {
  vendor: 'nvidia' | 'amd' | 'none';
  name?: string;
  available: boolean;
}

/**
 * Detect system capabilities for Faster Whisper
 */
export async function detectSystemCapabilities(): Promise<SystemInfo> {
  try {
    // Detect Python
    const pythonInfo = await detectPython();
    
    // Detect GPU
    const gpuInfo = await detectGPU();
    
    // Get platform info
    const platform = await getPlatform();
    
    return {
      hasPython: pythonInfo.available,
      pythonVersion: pythonInfo.version,
      pythonPath: pythonInfo.path,
      hasNvidiaGPU: gpuInfo.vendor === 'nvidia',
      hasAMDGPU: gpuInfo.vendor === 'amd',
      gpuName: gpuInfo.name,
      platform: platform.os,
      architecture: platform.arch,
    };
  } catch (error) {
    logger.error('SystemDetection', 'System detection failed', error);
    throw error;
  }
}

/**
 * Detect Python installation
 */
async function detectPython(): Promise<{ available: boolean; version?: string; path?: string }> {
  try {
    // Try python3 first, then python
    const commands = ['python3 --version', 'python --version'];
    
    for (const cmd of commands) {
      try {
        const result = await invoke<string>('execute_shell_command', {
          command: cmd.split(' ')[0],
          args: ['--version'],
        });
        
        // Parse version from output like "Python 3.11.5"
        const versionMatch = result.match(/Python (\d+\.\d+\.\d+)/);
        if (versionMatch) {
          const version = versionMatch[1];
          const [major, minor] = version.split('.').map(Number);
          
          // Check if version is 3.11, 3.12, or 3.13
          if (major === 3 && (minor === 11 || minor === 12 || minor === 13)) {
            return {
              available: true,
              version,
              path: cmd.split(' ')[0],
            };
          }
        }
      } catch {
        continue;
      }
    }
    
    return { available: false };
  } catch (error) {
    logger.error('PythonDetection', 'Python detection failed', error);
    return { available: false };
  }
}

/**
 * Detect GPU (NVIDIA or AMD)
 */
async function detectGPU(): Promise<GPUInfo> {
  try {
    // Try NVIDIA first
    try {
      const result = await invoke<string>('execute_shell_command', {
        command: 'nvidia-smi',
        args: ['--query-gpu=name', '--format=csv,noheader'],
      });
      
      if (result && result.trim()) {
        return {
          vendor: 'nvidia',
          name: result.trim(),
          available: true,
        };
      }
    } catch {
      // NVIDIA not found, try AMD
    }
    
    // Try AMD
    try {
      const result = await invoke<string>('execute_shell_command', {
        command: 'rocm-smi',
        args: ['--showproductname'],
      });
      
      if (result && result.includes('GPU')) {
        return {
          vendor: 'amd',
          name: 'AMD GPU',
          available: true,
        };
      }
    } catch {
      // AMD not found
    }
    
    return {
      vendor: 'none',
      available: false,
    };
  } catch (error) {
    logger.error('GPUDetection', 'GPU detection failed', error);
    return {
      vendor: 'none',
      available: false,
    };
  }
}

/**
 * Get platform information
 */
async function getPlatform(): Promise<{ os: 'windows' | 'macos' | 'linux'; arch: string }> {
  try {
    const os = await invoke<string>('get_platform_os');
    const arch = await invoke<string>('get_platform_arch');
    
    return {
      os: os as 'windows' | 'macos' | 'linux',
      arch,
    };
  } catch (error) {
    // Fallback to browser detection
    const platform = navigator.platform.toLowerCase();
    let os: 'windows' | 'macos' | 'linux' = 'linux';
    
    if (platform.includes('win')) os = 'windows';
    else if (platform.includes('mac')) os = 'macos';
    
    return {
      os,
      arch: 'x64',
    };
  }
}

/**
 * Check if Python version is supported (3.11, 3.12, or 3.13)
 */
export function isPythonVersionSupported(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major === 3 && (minor === 11 || minor === 12 || minor === 13);
}

/**
 * Get recommended device type based on system capabilities
 */
export function getRecommendedDevice(systemInfo: SystemInfo): 'cuda' | 'cpu' {
  return systemInfo.hasNvidiaGPU ? 'cuda' : 'cpu';
}

/**
 * Get recommended quantization type based on device
 */
export function getRecommendedQuantization(device: 'cuda' | 'cpu'): string {
  if (device === 'cuda') {
    return 'bfloat16'; // Best balance of speed and quality for GPU
  }
  return 'float32'; // CPU only supports float32 reliably
}
