/**
 * Ollama Status Component
 * Minimalist inline setting row with integrated toggle and status
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowClockwiseIcon as ArrowClockwise,
  CaretDownIcon as CaretDown,
} from '@phosphor-icons/react';
import { useOllama } from '@/features/models/hooks/useOllama';
import { Toggle } from '@/ui/primitives/Toggle';

interface OllamaStatusProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}

export const OllamaStatus = ({ enabled, onToggle }: OllamaStatusProps) => {
  const { status, isChecking, checkStatus } = useOllama();
  const [isExpanded, setIsExpanded] = useState(false);

  // Separate local and cloud models
  const MIN_LOCAL_MODEL_SIZE = 1024 * 1024; // 1MB threshold
  const localModels = status.models.filter(m => m.size > MIN_LOCAL_MODEL_SIZE);
  const cloudModels = status.models.filter(m => m.size <= MIN_LOCAL_MODEL_SIZE);

  const handleRowClick = () => {
    if (enabled && status.isRunning && status.models.length > 0) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Main Settings Row */}
      <div 
        className="flex items-center justify-between py-3 hover:bg-gray-50 dark:hover:bg-surface-base transition-smooth px-3 -mx-3 rounded-lg group cursor-pointer"
        onClick={handleRowClick}
      >
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-700 dark:text-gray-300 font-normal transition-colors duration-300 pointer-events-none">
              Enable Ollama
            </label>
            
            {/* Minimal Status Text Inline */}
            {enabled && (
              <span className={`text-2xs uppercase tracking-wider font-semibold ${status.isRunning ? 'text-secondary dark:text-secondary' : 'text-secondary dark:text-secondary'}`}>
                {status.isRunning ? 'Running' : 'Not Running'}
              </span>
            )}
          </div>
          
          <p className="text-xs text-gray-500 dark:text-gray-600 mt-0.5 transition-colors duration-300 flex items-center gap-2 pointer-events-none">
            {enabled && status.isRunning ? (
              <>
                <span>{localModels.length} local models</span>
                <span className="opacity-40">•</span>
                <span>{cloudModels.length} cloud models</span>
              </>
            ) : (
              "Show local Ollama models in model selector"
            )}
          </p>
        </div>

        <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
          {enabled && (
            <button
              onClick={checkStatus}
              disabled={isChecking}
              className="text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors duration-300 p-1"
              title="Refresh Models"
            >
              <ArrowClockwise size={16} className={isChecking ? 'animate-spin' : ''} />
            </button>
          )}

          <Toggle checked={enabled} onChange={onToggle} />
          
          {enabled && status.isRunning && status.models.length > 0 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 p-1 transition-transform duration-300"
            >
              <CaretDown 
                size={16} 
                className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Models List */}
      <AnimatePresence>
        {isExpanded && enabled && status.isRunning && status.models.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-1 py-4 space-y-6">
              {/* Local Models */}
              {localModels.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-600 tracking-wider transition-colors duration-300">
                    LOCAL MODELS
                  </h3>
                  <div className="space-y-3">
                    {localModels.map((model) => (
                      <div key={model.name} className="flex items-center justify-between group">
                        <span className="text-sm text-gray-800 dark:text-gray-200 transition-colors duration-300">
                          {model.name}
                        </span>
                        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 transition-colors duration-300">
                          <span>{model.details.parameter_size || 'Unknown'}</span>
                          <span className="opacity-40">•</span>
                          <span>{(model.size / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cloud Models */}
              {cloudModels.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-600 tracking-wider transition-colors duration-300">
                    CLOUD MODELS
                  </h3>
                  <div className="space-y-3">
                    {cloudModels.map((model) => (
                      <div key={model.name} className="flex items-center justify-between opacity-60 group">
                        <span className="text-sm text-gray-700 dark:text-gray-300 transition-colors duration-300">
                          {model.name}
                        </span>
                        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 transition-colors duration-300">
                          <span>Remote</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
