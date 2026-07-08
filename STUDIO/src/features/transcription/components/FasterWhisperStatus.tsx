/**
 * Faster Whisper Status Component
 * Minimal and elegant UI following app design philosophy (strict-neutral).
 * Only renders when Faster Whisper feature is enabled.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CpuIcon as Cpu, DownloadSimpleIcon as DownloadSimple, InfoIcon as Info } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { Success, Refresh, Delete, Warning, Icon } from '@/components/icons';
import { useFasterWhisper } from '@/features/transcription/hooks/useFasterWhisper';
import { useFeatures } from '@/hooks/useFeatures';
import {
  installFasterWhisper,
  downloadModel,
  deleteModel,
  getInstalledModelsInfo,
  setSelectedModel,
  detectSystemCapabilities,
  getRecommendedModels,
  type InstallationProgress,
  type ModelDownloadProgress,
  type InstalledModelInfo,
} from '@/features/transcription/services/fasterWhisper';
import { logger } from '@/services/logging/logger';

export const FasterWhisperStatus = () => {
  const { isEnabled } = useFeatures();
  const { config, isInstalled, isLoading, refresh } = useFasterWhisper();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallationProgress | null>(null);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledModelInfo[]>([]);
  const [systemInfo, setSystemInfo] = useState<{ hasPython?: boolean; hasNvidiaGPU?: boolean } | null>(null);

  // Load installed models and system info
  useEffect(() => {
    if (!isEnabled('fasterWhisper')) return;

    const loadData = async () => {
      if (isInstalled) {
        const models = await getInstalledModelsInfo();
        setInstalledModels(models);
      }
      
      try {
        const info = await detectSystemCapabilities();
        setSystemInfo(info);
      } catch (error) {
        logger.error('FasterWhisperStatus', 'Failed to detect system', error);
      }
    };
    
    loadData();
  }, [isEnabled, isInstalled]);

  // Don't render if Faster Whisper feature is disabled — placed AFTER all hooks
  // (no conditional hook calls; satisfies react-hooks/rules-of-hooks — see 03 BUG-001).
  if (!isEnabled('fasterWhisper')) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallProgress(null);
    
    try {
      const result = await installFasterWhisper((progress) => {
        setInstallProgress(progress);
      });
      
      if (result.success) {
        await refresh();
      }
    } catch (error) {
      logger.error('FasterWhisperStatus', 'Installation failed', error);
    } finally {
      setIsInstalling(false);
      setInstallProgress(null);
    }
  };

  const handleDownloadModel = async (modelName: string) => {
    setDownloadingModel(modelName);
    setDownloadProgress(null);
    
    try {
      const result = await downloadModel(modelName, (progress) => {
        setDownloadProgress(progress);
      });
      
      if (result.success) {
        const models = await getInstalledModelsInfo();
        setInstalledModels(models);
        await refresh();
      }
    } catch (error) {
      logger.error('FasterWhisperStatus', 'Download failed', error);
    } finally {
      setDownloadingModel(null);
      setDownloadProgress(null);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    try {
      const result = await deleteModel(modelName);
      if (!result.success) {
        logger.error('FasterWhisperStatus', `Failed to delete model: ${result.error}`);
        return;
      }
      const models = await getInstalledModelsInfo();
      setInstalledModels(models);
      await refresh();
    } catch (error) {
      logger.error('FasterWhisperStatus', 'Delete failed', error);
    }
  };

  const handleSelectModel = async (modelName: string) => {
    try {
      await setSelectedModel(modelName);
      await refresh();
    } catch (error) {
      logger.error('FasterWhisperStatus', 'Failed to select model', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <Spinner size="sm" className="text-muted" />
          <span className="text-sm text-secondary">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Main Status Row - Minimal Design */}
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-2">
          {/* Status Indicator — strict-neutral (D-401): healthy = strong dot, not green */}
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

          {/* Device & Model Info */}
          {isInstalled && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Icon icon={Cpu} size="xs" className="text-muted" />
              <span>{installedModels.length} model{installedModels.length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {isInstalled && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Show details"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <Icon icon={Info} size="sm" />
            </IconButton>
          )}
          
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Refresh status"
            onClick={refresh}
            disabled={isLoading}
          >
            {isLoading ? <Spinner size="sm" decorative /> : <Refresh size="sm" />}
          </IconButton>
        </div>
      </div>

      {/* Installation Progress - Minimal Circular Progress */}
      <AnimatePresence>
        {isInstalling && installProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 py-2">
              {/* Circular Progress */}
              <div className="relative w-4 h-4">
                <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    className="text-surface-border"
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 6}`}
                    strokeDashoffset={`${2 * Math.PI * 6 * (1 - installProgress.progress)}`}
                    className="text-primary transition-[stroke-dashoffset] duration-normal ease-standard"
                  />
                </svg>
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary truncate">{installProgress.message}</p>
                {installProgress.package && (
                  <p className="text-xs text-secondary truncate">{installProgress.package}</p>
                )}
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsInstalling(false);
                  setInstallProgress(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download Progress - Minimal */}
      <AnimatePresence>
        {downloadingModel && downloadProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 py-2">
              <div className="relative w-4 h-4">
                <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    className="text-surface-border"
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 6}`}
                    strokeDashoffset={`${2 * Math.PI * 6 * (1 - downloadProgress.progress)}`}
                    className="text-primary transition-[stroke-dashoffset] duration-normal ease-standard"
                  />
                </svg>
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary truncate">Downloading {downloadProgress.modelName}</p>
                <p className="text-xs text-secondary truncate">{downloadProgress.message}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expandable Details - Clean List */}
      <AnimatePresence>
        {isExpanded && isInstalled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-2 border-t border-surface-divider">
              {/* Installed Models */}
              {installedModels.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-secondary uppercase tracking-wide">Models</p>
                  {installedModels.map((model) => (
                    <div
                      key={model.name}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-primary truncate">
                            {model.metadata.displayName}
                          </p>
                          {config?.selectedModel === model.name && (
                            <span className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <p className="text-xs text-secondary">
                          {(model.size / 1024 / 1024).toFixed(0)} MB
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {config?.selectedModel !== model.name && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSelectModel(model.name)}
                          >
                            Select
                          </Button>
                        )}
                        <IconButton
                          variant="destructive"
                          size="sm"
                          aria-label={`Delete model ${model.metadata.displayName}`}
                          onClick={() => handleDeleteModel(model.name)}
                        >
                          <Delete size="xs" />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Download New Model */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-secondary uppercase tracking-wide">Available</p>
                <div className="space-y-1">
                  {getRecommendedModels().map((model) => {
                    const isModelInstalled = installedModels.some(m => m.name === model.name);
                    const isDownloading = downloadingModel === model.name;
                    
                    return (
                      <div
                        key={model.id}
                        className="flex items-center justify-between py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-primary truncate">
                            {model.displayName}
                          </p>
                          <p className="text-xs text-secondary">
                            {model.estimatedSize} MB
                          </p>
                        </div>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label={isModelInstalled ? `Model ${model.displayName} installed` : `Download model ${model.displayName}`}
                          onClick={() => handleDownloadModel(model.name)}
                          disabled={isModelInstalled || isDownloading}
                        >
                          {isModelInstalled ? (
                            <Success size="xs" className="text-primary" />
                          ) : isDownloading ? (
                            <Spinner size="sm" decorative />
                          ) : (
                            <Icon icon={DownloadSimple} size="xs" />
                          )}
                        </IconButton>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Not Installed State - Minimal */}
      {!isInstalled && !isInstalling && (
        <div className="py-2">
          <p className="text-sm text-primary mb-3">
            Local transcription with your {systemInfo?.hasNvidiaGPU ? 'GPU' : 'CPU'}
          </p>
          
          {!systemInfo?.hasPython && (
            <div className="mb-3 p-3 bg-surface-raised border border-surface-border rounded-lg flex items-start gap-2">
              <Warning size="sm" className="text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-secondary">
                Python 3.11+ required.
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
            Install Faster Whisper
          </Button>
        </div>
      )}
    </div>
  );
};
