/**
 * Edge TTS Hook
 * Manages Edge TTS installation state — mirrors useFasterWhisper.
 */

import { useState, useEffect, useCallback } from 'react';
import { loadConfig, type EdgeTtsConfig } from '@/features/tts/local';
import { logger } from '@/core/logging/logger';

export interface UseEdgeTtsResult {
  config: EdgeTtsConfig | null;
  isInstalled: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useEdgeTts(): UseEdgeTtsResult {
  const [config, setConfig] = useState<EdgeTtsConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await loadConfig();
      setConfig(loadedConfig);
    } catch (error) {
      logger.error('useEdgeTts', 'Failed to load configuration', error);
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
