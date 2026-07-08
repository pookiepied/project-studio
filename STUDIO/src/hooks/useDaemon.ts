/**
 * useDaemon Hook
 * Manages the Local Provider Daemon lifecycle and status
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useFeatures } from './useFeatures';
import { useSettings } from '../contexts/SettingsContext';
import { logger } from '../services/logging/logger';

export interface DaemonStatus {
  running: boolean;
  port: number;
  error: string | null;
}

export interface UseDaemonResult {
  status: DaemonStatus;
  isStarting: boolean;
  isStopping: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const DEFAULT_STATUS: DaemonStatus = {
  running: false,
  port: 11435,
  error: null,
};

export function useDaemon(): UseDaemonResult {
  const { isEnabled } = useFeatures();
  const { settings } = useSettings();
  const isAvailable = isEnabled('localProviderBridge');

  const [status, setStatus] = useState<DaemonStatus>(DEFAULT_STATUS);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    if (!isAvailable) return;

    const hydrateStatus = async () => {
      try {
        const [running, port] = await Promise.all([
          invoke<boolean>('local_provider_is_running'),
          invoke<number>('local_provider_port'),
        ]);

        setStatus({
          running,
          port,
          error: null,
        });

        logger.info('useDaemon', `Hydrated status: running=${running}, port=${port}`);
      } catch (error) {
        logger.error('useDaemon', 'Failed to hydrate daemon status', error);
      }
    };

    hydrateStatus();
  }, [isAvailable]);

  // All hooks must be called unconditionally — guard is inside each one
  useEffect(() => {
    if (!isAvailable) return;

    const unsubscribePromise = listen('local-provider-status', (payload: any) => {
      const daemonEvent = payload.payload as { running: boolean; port: number; error?: string };
      setStatus({
        running: daemonEvent.running,
        port: daemonEvent.port,
        error: daemonEvent.error ?? null,
      });
      logger.info('useDaemon', `Status updated: running=${daemonEvent.running}`);
    });

    return () => {
      unsubscribePromise.then(unsub => unsub()).catch(err => {
        logger.error('useDaemon', 'Failed to unsubscribe from daemon events', err);
      });
    };
  }, [isAvailable]);

  const start = useCallback(async () => {
    if (!isAvailable) {
      throw new Error('Local provider bridge is not available on this platform');
    }
    if (status.running) {
      logger.warn('useDaemon', 'Daemon is already running');
      return;
    }

    setIsStarting(true);
    try {
      await invoke('local_provider_start', {
        port: settings.localProviderPort,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        lmStudioBaseUrl: settings.lmstudioBaseUrl,
      });
      logger.info('useDaemon', 'Daemon start command sent');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setStatus(prev => ({ ...prev, error: errorMsg }));
      logger.error('useDaemon', 'Failed to start daemon', error);
      throw error;
    } finally {
      setIsStarting(false);
    }
  }, [isAvailable, status.running, settings.localProviderPort, settings.ollamaBaseUrl, settings.lmstudioBaseUrl]);

  const stop = useCallback(async () => {
    if (!isAvailable) {
      throw new Error('Local provider bridge is not available on this platform');
    }
    if (!status.running) {
      logger.warn('useDaemon', 'Daemon is not running');
      return;
    }

    setIsStopping(true);
    try {
      await invoke('local_provider_stop');
      logger.info('useDaemon', 'Daemon stop command sent');
    } catch (error) {
      logger.error('useDaemon', 'Failed to stop daemon', error);
      throw error;
    } finally {
      setIsStopping(false);
    }
  }, [isAvailable, status.running]);

  return { status, isStarting, isStopping, start, stop };
}
