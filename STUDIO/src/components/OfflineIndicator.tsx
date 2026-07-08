/**
 * Offline Indicator
 * Minimal banner that shows when offline
 * Matches STUDIO design system
 */

import { motion, AnimatePresence } from "framer-motion";
import { WifiSlash } from "@phosphor-icons/react";
import { useOffline } from "../contexts/OfflineContext";

export const OfflineIndicator = () => {
  const { isOffline } = useOffline();

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="bg-gray-100 border-b border-gray-200"
        >
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <WifiSlash size={14} />
              <span className="font-medium tracking-wide">Offline Mode</span>
              <span className="text-gray-500">|</span>
              <span className="text-gray-500">
                Some features are limited
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
