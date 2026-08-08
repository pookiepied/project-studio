/**
 * Parakeet Hook
 * Manages Parakeet-TDT installation state — mirrors the old useFasterWhisper.
 */

import { useState, useEffect, useCallback } from 'react';
import { loadConfig, type ParakeetConfig } from '@/features/transcription/services/parakeet';
import { logger } from '@/core/logging/logger';

export interface UseParakeetResult {
  config: ParakeetConfig | null;
  isInstalled: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useParakeet(): UseParakeetResult {
  const [config, setConfig] = useState<ParakeetConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await loadConfig();
      setConfig(loadedConfig);
    } catch (error) {
      logger.error('useParakeet', 'Failed to load configuration', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    config,
    isInstalled: config?.installed ?? false,
    isLoading,
    refresh,
  };
}
