/**
 * LM Studio Status Component
 * Local bridge-backed LM Studio status row with inline toggle and model list
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Redo,
  Expand,
} from '@/ui/icons';
import { Toggle } from '@/ui/primitives/Toggle';
import { IconButton } from '@/ui/primitives/IconButton';
import { useDaemon } from '@/features/models/hooks/useLocalProviderDaemon';
import { createDaemonClient, LocalModel } from '@/core/daemon/daemonClient';

interface LMStudioStatusProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}

export const LMStudioStatus = ({ enabled, onToggle }: LMStudioStatusProps) => {
  const { status } = useDaemon();
  const [isChecking, setIsChecking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [models, setModels] = useState<LocalModel[]>([]);

  const checkStatus = async () => {
    if (!enabled || !status.running) {
      setIsConnected(false);
      setModels([]);
      return;
    }

    setIsChecking(true);
    try {
      const client = createDaemonClient(status.port);
      const [health, daemonModels] = await Promise.all([
        client.checkHealth(),
        client.fetchModels(false),
      ]);

      const lmstudioModels = daemonModels.filter((m) => m.provider === 'lmstudio');
      setIsConnected(Boolean(health?.providers?.lmstudio));
      setModels(lmstudioModels);
    } catch {
      setIsConnected(false);
      setModels([]);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
    // checkStatus is component-local (poll only when enabled/running/port change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status.running, status.port]);

  const handleRowClick = () => {
    if (enabled && status.running && isConnected && models.length > 0) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center justify-between py-3 hover:bg-surface-page dark:hover:bg-surface-base transition-smooth px-3 -mx-3 rounded-lg group cursor-pointer"
        onClick={handleRowClick}
      >
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <label className="text-sm text-secondary dark:text-disabled font-normal transition-colors duration-300 pointer-events-none">
              Enable LM Studio
            </label>

            {enabled && (
              <span className={`text-2xs uppercase tracking-wider font-semibold ${isConnected ? 'text-secondary dark:text-secondary' : 'text-secondary dark:text-secondary'}`}>
                {status.running ? (isConnected ? 'Running' : 'Not Running') : 'Bridge Off'}
              </span>
            )}
          </div>

          <p className="text-xs text-muted dark:text-secondary mt-0.5 transition-colors duration-300 pointer-events-none">
            {!enabled
              ? 'Include local LM Studio models in model selector'
              : !status.running
                ? 'Start Local Provider Bridge to discover LM Studio models'
                : isConnected
                  ? `${models.length} local models`
                  : 'LM Studio is not connected to the bridge'}
          </p>
        </div>

        <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
          {enabled && status.running && (
            <IconButton
              onClick={checkStatus}
              disabled={isChecking}
              aria-label="Refresh models"
              title="Refresh Models"
              className="text-disabled hover:text-primary dark:hover:text-disabled transition-colors duration-300 p-1"
            >
              <Redo size="md" className={isChecking ? 'animate-spin' : ''} />
            </IconButton>
          )}

          <Toggle checked={enabled} onChange={onToggle} />

          {enabled && status.running && isConnected && models.length > 0 && (
            <IconButton
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label="Toggle models"
              className="text-disabled p-1 transition-transform duration-300"
            >
              <Expand
                size="md"
                className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
              />
            </IconButton>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && enabled && status.running && isConnected && models.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-1 py-4 space-y-4">
              <h3 className="text-xs font-semibold text-muted dark:text-secondary tracking-wider transition-colors duration-300">
                LM STUDIO MODELS
              </h3>
              <div className="space-y-3">
                {models.map((model) => (
                  <div key={model.id} className="flex items-center justify-between group">
                    <span className="text-sm text-primary dark:text-disabled transition-colors duration-300">
                      {model.name}
                    </span>
                    {typeof model.size === 'number' && (
                      <div className="flex items-center gap-3 text-xs text-disabled dark:text-muted transition-colors duration-300">
                        <span>{(model.size / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
