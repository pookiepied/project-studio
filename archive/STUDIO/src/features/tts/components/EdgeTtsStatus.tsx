/**
 * Edge TTS Status Component
 * Minimal settings UI for the local Edge TTS addon — status + install button,
 * plus a read-only voice list for reference. Voice *selection* happens in
 * the "Text-to-Speech Model" picker on the Intelligence settings page (same
 * as every other provider's model picking) — this component doesn't own
 * that anymore, it only reports install/availability, same pattern as
 * OllamaStatus / ParakeetStatus.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/ui/primitives/Button';
import { Spinner } from '@/ui/primitives/Spinner';
import { Success, Warning } from '@/ui/icons';
import { useEdgeTts } from '@/features/tts/hooks/useEdgeTts';
import { useFeatures } from '@/app/hooks/useFeatures';
import {
  installEdgeTts,
  detectPython,
  CURATED_EDGE_TTS_VOICES,
  type InstallationProgress,
} from '@/features/tts/local';
import { logger } from '@/core/logging/logger';

export const EdgeTtsStatus = () => {
  const { isEnabled } = useFeatures();
  const { config, isInstalled, isLoading, refresh } = useEdgeTts();
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallationProgress | null>(null);
  const [hasPython, setHasPython] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isEnabled('edgeTts') || isInstalled) return;
    detectPython()
      .then((info) => setHasPython(info.hasPython))
      .catch((error) => logger.error('EdgeTtsStatus', 'Failed to detect Python', error));
  }, [isEnabled, isInstalled]);

  if (!isEnabled('edgeTts')) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallProgress(null);
    try {
      const result = await installEdgeTts((progress) => setInstallProgress(progress));
      if (result.success) {
        await refresh();
      }
    } catch (error) {
      logger.error('EdgeTtsStatus', 'Installation failed', error);
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

      {/* Voices — informational only; pick the active one in Settings → Intelligence → Text-to-Speech Model */}
      {isInstalled && (
        <div className="space-y-2 pt-2 border-t border-surface-divider">
          <p className="text-xs font-medium text-secondary uppercase tracking-wide">
            {CURATED_EDGE_TTS_VOICES.length} voices available
          </p>
          <p className="text-xs text-muted">
            Pick one under Intelligence → Text-to-Speech Model.
          </p>
        </div>
      )}

      {/* Not installed */}
      {!isInstalled && !isInstalling && (
        <div className="py-2">
          <p className="text-sm text-primary mb-3">
            Free, multilingual text-to-speech from Microsoft Edge — runs locally, no API key required.
          </p>

          {hasPython === false && (
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
            disabled={hasPython === false}
            className="w-full"
          >
            Install Edge TTS
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
