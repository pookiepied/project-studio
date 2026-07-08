/**
 * Context Autocomplete Component
 * @chat mention autocomplete with search, and @app MCP selector
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextReference } from '@/features/chat/services/contextRetrievalService';
import { ChatCircleDotsIcon as ChatCircleDots, PlugIcon as Plug, CloudIcon as Cloud } from '@phosphor-icons/react';
import { AppLogo } from '@/components/brand';

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
  contexts: ContextReference[];
  onSelect: (context: ContextReference) => void;
  onClose: () => void;
  searchQuery: string;
  position: { x: number; y: number };
  apps?: AppMention[];
  onSelectApp?: (app: AppMention) => void;
}

export const ContextAutocomplete = ({
  isVisible,
  contexts,
  onSelect,
  onClose,
  searchQuery,
  position,
  apps = [],
  onSelectApp,
}: ContextAutocompleteProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredContexts, setFilteredContexts] = useState<ContextReference[]>([]);
  const [filteredApps, setFilteredApps] = useState<AppMention[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter contexts and apps based on search query
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setFilteredContexts(contexts);
      setFilteredApps(apps);
      return;
    }

    const filtered = contexts.filter(ctx => {
      const titleMatch = ctx.title.toLowerCase().includes(query);
      const previewMatch = ctx.preview.toLowerCase().includes(query);
      if (ctx.type === 'chat') {
        const titleWords = ctx.title.toLowerCase().split(' ').slice(0, 3).join(' ');
        return titleMatch || previewMatch || titleWords.includes(query);
      }
      return titleMatch || previewMatch;
    });

    setFilteredContexts(filtered);
    setFilteredApps(apps.filter(a => a.name.toLowerCase().includes(query)));
    setSelectedIndex(0);
  }, [contexts, apps, searchQuery]);

  // Handle keyboard navigation (apps listed first, then chats)
  useEffect(() => {
    const totalItems = filteredApps.length + filteredContexts.length;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible || totalItems === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => prev < totalItems - 1 ? prev + 1 : 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : totalItems - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex < filteredApps.length) {
            onSelectApp?.(filteredApps[selectedIndex]);
          } else {
            const ctxIdx = selectedIndex - filteredApps.length;
            if (filteredContexts[ctxIdx]) onSelect(filteredContexts[ctxIdx]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, filteredApps, filteredContexts, selectedIndex, onSelect, onSelectApp, onClose]);

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

  if (!isVisible || (filteredContexts.length === 0 && filteredApps.length === 0)) {
    return null;
  }

  const totalItems = filteredApps.length + filteredContexts.length;

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
          {/* Apps section */}
          {filteredApps.length > 0 && (
            <>
              <p className="px-3 py-1.5 text-2xs font-semibold text-gray-400 dark:text-gray-600 tracking-wider uppercase">Apps</p>
              {filteredApps.map((app, i) => (
                <button
                  key={app.id}
                  onClick={() => onSelectApp?.(app)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors ${
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
                        <Cloud size={13} weight="fill" className="text-gray-400 dark:text-gray-500" />
                      ) : (
                        <Plug size={13} weight="regular" className="text-gray-400 dark:text-gray-600" />
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
                </button>
              ))}
            </>
          )}

          {/* Chats section */}
          {filteredContexts.length > 0 && (
            <>
              <p className="px-3 py-1.5 text-2xs font-semibold text-gray-400 dark:text-gray-600 tracking-wider uppercase mt-1">Chats</p>
              {filteredContexts.map((context, i) => {
                const globalIdx = filteredApps.length + i;
                return (
                  <button
                    key={`${context.type}-${context.id}`}
                    onClick={() => onSelect(context)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors ${
                      globalIdx === selectedIndex
                        ? 'bg-gray-50 dark:bg-surface-selected'
                        : 'hover:bg-gray-50 dark:hover:bg-surface-selected'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-surface-raised dark:bg-surface-raised/30 border border-surface-border dark:border-surface-border/30 flex items-center justify-center flex-shrink-0">
                      <ChatCircleDots size={13} weight="duotone" className="text-secondary" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-200 leading-tight truncate">{context.title}</p>
                      <p className="text-2xs text-gray-400 dark:text-gray-600 leading-tight truncate">{context.preview}</p>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {totalItems === 0 && (
            <p className="px-3 py-4 text-xs text-gray-400 text-center">No results</p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

/**
 * Hook for managing context autocomplete state
 */
export const useContextAutocomplete = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [mentionType, setMentionType] = useState<'chat' | null>(null);
  // Tracks the start offset of the @-mention in the textarea for replacement
  const [mentionStart, setMentionStart] = useState(0);

  const show = (type: 'chat' | null, pos: { x: number; y: number }, query: string = '', start = 0) => {
    setMentionType(type);
    setPosition(pos);
    setSearchQuery(query);
    setMentionStart(start);
    setIsVisible(true);
  };

  const hide = () => {
    setIsVisible(false);
    setSearchQuery('');
    setMentionType(null);
  };

  const updateQuery = (query: string) => {
    setSearchQuery(query);
  };

  return {
    isVisible,
    searchQuery,
    position,
    mentionType,
    mentionStart,
    show,
    hide,
    updateQuery
  };
};