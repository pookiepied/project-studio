/**
 * Ollama Hook
 * Manages Ollama connection state and provides status updates
 */

import { useState, useEffect, useCallback } from 'react';
import { checkOllamaStatus, OllamaStatus, getOllamaModels } from '../services/ai/ollamaService';
import { useSettings } from '../contexts/SettingsContext';
import { logger } from '../services/logging/logger';

export interface UseOllamaResult {
  status: OllamaStatus;
  isChecking: boolean;
  checkStatus: () => Promise<void>;
  refreshModels: () => Promise<void>;
}

/**
 * Hook to manage Ollama connection and status
 * Automatically checks on mount and provides manual refresh
 */
export function useOllama(): UseOllamaResult {
  const { settings } = useSettings();
  const [status, setStatus] = useState<OllamaStatus>({
    isRunning: false,
    isAvailable: false,
    models: [],
  });
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    // Skip if Ollama is disabled in settings
    if (!settings.ollamaEnabled) {
      setStatus({
        isRunning: false,
        isAvailable: false,
        models: [],
      });
      return;
    }

    setIsChecking(true);
    try {
      const ollamaStatus = await checkOllamaStatus();
      setStatus(ollamaStatus);
      
    } catch (error) {
      logger.error('Ollama', 'Status check failed', error);
      setStatus({
        isRunning: false,
        isAvailable: false,
        models: [],
      });
    } finally {
      setIsChecking(false);
    }
  }, [settings.ollamaEnabled]);

  const refreshModels = useCallback(async () => {
    if (!settings.ollamaEnabled) return;
    
    setIsChecking(true);
    try {
      const result = await getOllamaModels();
      if (result.success && result.data) {
        setStatus(prev => ({
          ...prev,
          models: result.data || [],
        }));
      }
    } catch (error) {
      logger.error('Ollama', 'Failed to refresh models', error);
    } finally {
      setIsChecking(false);
    }
  }, [settings.ollamaEnabled]);

  // Check status on mount and when ollamaEnabled changes
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    status,
    isChecking,
    checkStatus,
    refreshModels,
  };
}
