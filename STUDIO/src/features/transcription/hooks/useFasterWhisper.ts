/**
 * Faster Whisper Hook
 * Manages Faster Whisper state and provides UI-friendly interface
 */

import { useState, useEffect, useCallback } from 'react';
import {
  loadConfig,
  type FasterWhisperConfig,
} from '@/features/transcription/services/fasterWhisper';
import { logger } from '@/services/logging/logger';

export interface UseFasterWhisperResult {
  config: FasterWhisperConfig | null;
  isInstalled: boolean;
  isLoading: boolean;
  selectedModel: string | undefined;
  installedModels: string[];
  refresh: () => Promise<void>;
}

/**
 * Hook to manage Faster Whisper state
 */
export function useFasterWhisper(): UseFasterWhisperResult {
  const [config, setConfig] = useState<FasterWhisperConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await loadConfig();
      setConfig(loadedConfig);
    } catch (error) {
      logger.error('useFasterWhisper', 'Failed to load config', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load config on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    config,
    isInstalled: config?.installed ?? false,
    isLoading,
    selectedModel: config?.selectedModel,
    installedModels: config?.installedModels ?? [],
    refresh,
  };
}
