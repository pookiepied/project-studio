/**
 * Parakeet Status Component
 * Minimal settings UI for the local Parakeet-TDT engine — single-model, so
 * this is a lot simpler than the old FasterWhisperStatus (no per-model list,
 * no quantization picker). Follows the same strict-neutral status pattern.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/ui/primitives/Button';
import { Spinner } from '@/ui/primitives/Spinner';
import { Success, Warning } from '@/ui/icons';
import { useParakeet } from '@/features/transcription/hooks/useParakeet';
import { useFeatures } from '@/app/hooks/useFeatures';
import {
  installParakeet,
  detectSystemCapabilities,
  type InstallationProgress,
} from '@/features/transcription/services/parakeet';
import { logger } from '@/core/logging/logger';

export const ParakeetStatus = () => {
  const { isEnabled } = useFeatures();
  const { config, isInstalled, isLoading, refresh } = useParakeet();
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallationProgress | null>(null);
  const [systemInfo, setSystemInfo] = useState<{ hasPython?: boolean } | null>(null);

  useEffect(() => {
    if (!isEnabled('parakeet') || isInstalled) return;
    detectSystemCapabilities()
      .then(setSystemInfo)
      .catch((error) => logger.error('ParakeetStatus', 'Failed to detect system', error));
  }, [isEnabled, isInstalled]);

  if (!isEnabled('parakeet')) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallProgress(null);
    try {
      const result = await installParakeet((progress) => setInstallProgress(progress));
      if (result.success) {
        await refresh();
      }
    } catch (error) {
      logger.error('ParakeetStatus', 'Installation failed', error);
    } finally {
      setIsInstalling(false);
      setInstallProgress(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-3">
        <Spinner size="sm" className="text-muted" />
        <span className="text-sm text-secondary">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Status row */}
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-2">
          {isInstalled ? (
            <span className="w-3.5 h-3.5 rounded-full bg-primary" />
          ) : (
            <div className="w-3.5 h-3.5 border-2 border-muted rounded-full" />
          )}
          <span className="text-sm text-primary font-normal">
            {isInstalled ? 'Ready' : 'Not Installed'}
          </span>
        </div>
      </div>

      {/* Install progress */}
      <AnimatePresence>
        {isInstalling && installProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 py-2">
              <div className="relative w-4 h-4">
                <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" className="text-surface-border" />
                  <circle
                    cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none"
                    strokeDasharray={`${2 * Math.PI * 6}`}
                    strokeDashoffset={`${2 * Math.PI * 6 * (1 - installProgress.progress)}`}
                    className="text-primary transition-[stroke-dashoffset] duration-normal ease-standard"
                  />
                </svg>
              </div>
              <p className="text-sm text-primary truncate flex-1 min-w-0">{installProgress.message}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Not installed */}
      {!isInstalled && !isInstalling && (
        <div className="py-2">
          <p className="text-sm text-primary mb-1">
            Parakeet-TDT 0.6B — English + ~25 European languages, local CPU inference.
          </p>
          <p className="text-xs text-secondary mb-3">
            Rarely hallucinates on silence, unlike Whisper-based transcription.
          </p>

          {!systemInfo?.hasPython && (
            <div className="mb-3 p-3 bg-surface-raised border border-surface-border rounded-lg flex items-start gap-2">
              <Warning size="sm" className="text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-secondary">
                Python 3.9+ required.
                <a
                  href="https://www.python.org/downloads/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline ml-1"
                >
                  Download Python
                </a>
              </p>
            </div>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={handleInstall}
            disabled={!systemInfo?.hasPython}
            className="w-full"
          >
            Install Parakeet-TDT
          </Button>
        </div>
      )}

      {isInstalled && (
        <div className="flex items-center gap-1.5 text-xs text-muted pt-1">
          <Success size="xs" className="text-primary" />
          <span>{config?.pythonVersion ? `Python ${config.pythonVersion}` : 'Installed'}</span>
        </div>
      )}
    </div>
  );
};
