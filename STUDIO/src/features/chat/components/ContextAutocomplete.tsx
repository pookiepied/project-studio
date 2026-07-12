/**
 * @app mention autocomplete — lists MCP connections and Composio apps.
 *
 * Driven by useAtMention(), which owns the popup's visibility, query and
 * position. The component is presentational apart from keyboard navigation.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlugIcon as Plug, CloudIcon as Cloud } from '@phosphor-icons/react';
import { AppLogo } from '@/ui/brand';
import { Button } from '@/ui/primitives/Button';

export interface AppMention {
  id: string;
  name: string;
  description?: string;
  type: 'local' | 'remote' | 'composio';
  isRunning?: boolean;
  logo?: string;
}

interface ContextAutocompleteProps {
  isVisible: boolean;
  onClose: () => void;
  searchQuery: string;
  position: { x: number; y: number };
  apps?: AppMention[];
  onSelectApp?: (app: AppMention) => void;
}

export const ContextAutocomplete = ({
  isVisible,
  onClose,
  searchQuery,
  position,
  apps = [],
  onSelectApp,
}: ContextAutocompleteProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredApps, setFilteredApps] = useState<AppMention[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter apps based on search query
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setFilteredApps(apps);
      return;
    }

    setFilteredApps(apps.filter(a => a.name.toLowerCase().includes(query)));
    setSelectedIndex(0);
  }, [apps, searchQuery]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible || filteredApps.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => prev < filteredApps.length - 1 ? prev + 1 : 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : filteredApps.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          onSelectApp?.(filteredApps[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, filteredApps, selectedIndex, onSelectApp, onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  if (!isVisible || filteredApps.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="fixed z-50 w-72 bg-white dark:bg-surface-raised rounded-2xl shadow-2xl border border-gray-100 dark:border-surface-border overflow-hidden"
        style={{
          left: Math.min(position.x, window.innerWidth - 288),
          bottom: window.innerHeight - Math.max(position.y, 80),
          maxHeight: 360,
        }}
      >
        <div className="overflow-y-auto max-h-[360px] scrollbar-auto-hide py-1.5">
          <p className="px-3 py-1.5 text-2xs font-semibold text-gray-400 dark:text-gray-600 tracking-wider uppercase">Apps</p>
          {filteredApps.map((app, i) => (
            <Button
              key={app.id}
              variant="ghost"
              onClick={() => onSelectApp?.(app)}
              className={`h-auto w-full justify-start gap-2.5 px-3 py-2 ${
                i === selectedIndex
                  ? 'bg-gray-50 dark:bg-surface-selected'
                  : 'hover:bg-gray-50 dark:hover:bg-surface-selected'
              }`}
            >
              <AppLogo
                src={app.logo}
                label={app.name}
                size="sm"
                className="!w-7 !h-7 !rounded-lg bg-gray-100 dark:bg-surface-selected border border-gray-200 dark:border-[#333]"
                fallback={
                  app.type === 'remote' || app.type === 'composio' ? (
                    <Cloud size={14} weight="fill" className="text-gray-400 dark:text-gray-500" />
                  ) : (
                    <Plug size={14} weight="regular" className="text-gray-400 dark:text-gray-600" />
                  )
                }
              />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-200 leading-tight truncate">{app.name}</p>
                <p className="text-2xs text-gray-400 dark:text-gray-600 leading-tight truncate">
                  {app.description
                    ? app.description
                    : app.isRunning ? 'Running' : app.type === 'composio' || app.type === 'remote' ? 'Cloud' : 'Local'}
                </p>
              </div>
              {app.isRunning && (
                <span className="w-1.5 h-1.5 rounded-full bg-surface-raised flex-shrink-0" />
              )}
            </Button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
