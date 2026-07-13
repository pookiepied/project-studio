/**
 * Local Provider Status Component
 * Shows daemon status and models from Ollama and LM Studio
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Redo,
  Info,
  Close,
} from '@/ui/icons';
import { useDaemon } from '@/features/models/hooks/useLocalProviderDaemon';
import { createDaemonClient } from '@/core/daemon/daemonClient';
import { Button } from '@/ui/primitives/Button';
import { IconButton } from '@/ui/primitives/IconButton';

export const LocalProviderStatus = () => {
  const { status, isStarting, start, stop } = useDaemon();
  const [isExpanded, setIsExpanded] = useState(false);
  const [daemonHealth, setDaemonHealth] = useState<any>(null);

  const checkDaemonHealth = async () => {
    if (!status.running) return;

    try {
      const client = createDaemonClient(status.port);
      const health = await client.checkHealth();
      setDaemonHealth(health);
    } catch (error) {
      console.error('Failed to check daemon health:', error);
      setDaemonHealth(null);
    }
  };

  // Check health when status changes
  useEffect(() => {
    if (status.running) {
      checkDaemonHealth();
    } else {
      setDaemonHealth(null);
    }
    // checkDaemonHealth is component-local (re-poll on running/port change only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.running, status.port]);

  const handleStart = async () => {
    try {
      await start();
    } catch (error) {
      console.error('Failed to start daemon:', error);
    }
  };

  const handleStop = async () => {
    try {
      await stop();
    } catch (error) {
      console.error('Failed to stop daemon:', error);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2"
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300 ${
          status.running ? 'bg-surface-raised animate-pulse' : status.error ? 'bg-surface-raised' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      />
      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
        {status.running ? 'Bridge Active' : status.error ? 'Bridge Error' : 'Bridge Stopped'}
      </span>

      <div className="flex items-center gap-1.5 ml-1">
        {status.running && daemonHealth && (
          <>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <p className="text-2xs text-gray-400 font-normal uppercase tracking-wider">
              Port {status.port}
            </p>
          </>
        )}
        {status.error && (
           <span className="text-2xs text-secondary font-medium ml-2">{status.error}</span>
        )}
      </div>

      <div className="flex-1" />

      {/* Action Buttons */}
      <div className="flex items-center gap-2 relative">
        {status.running ? (
          <Button
            variant="ghost"
            onClick={handleStop}
            disabled={isStarting}
            className="text-xs font-medium text-gray-400 hover:text-secondary transition-colors"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={handleStart}
            disabled={isStarting}
            className="text-xs font-medium text-gray-400 hover:text-secondary transition-colors"
          >
            {isStarting ? <Redo size="sm" className="animate-spin inline" /> : 'Start'}
          </Button>
        )}

        {status.running && (
          <>
            <IconButton
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label="Bridge details"
              title="Bridge Details"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <Info size="sm" />
            </IconButton>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-6 z-30 w-64 rounded-xl border border-gray-200 dark:border-surface-border bg-white dark:bg-surface-raised shadow-lg p-3 space-y-2 cursor-auto text-left"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide">Providers</span>
                    <IconButton onClick={() => setIsExpanded(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400">
                      <Close size="sm" />
                    </IconButton>
                  </div>

                  {daemonHealth?.providers?.ollama && (
                     <div className="flex items-center justify-between">
                       <span className="text-xs text-gray-500 dark:text-gray-400">Ollama</span>
                       <span className="text-xs text-secondary">Connected</span>
                     </div>
                  )}
                  {daemonHealth?.providers?.lmstudio && (
                     <div className="flex items-center justify-between">
                       <span className="text-xs text-gray-500 dark:text-gray-400">LM Studio</span>
                       <span className="text-xs text-secondary">Connected</span>
                     </div>
                  )}

                  {(!daemonHealth?.providers?.ollama && !daemonHealth?.providers?.lmstudio) && (
                     <div className="text-xs text-secondary dark:text-secondary leading-tight">
                       No local providers active. Run Ollama or LM Studio.
                     </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </  >
        )}
      </div>
    </motion.div>
  );
};
