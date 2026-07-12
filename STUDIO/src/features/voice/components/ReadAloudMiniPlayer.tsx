import { AnimatePresence, motion } from "framer-motion";
import {
  SpeakerHighIcon as SpeakerHigh,
  PauseIcon as Pause,
  PlayIcon as Play,
  XIcon as X,
} from "@phosphor-icons/react";
import { useTTSContext } from "@/features/voice/context/TTSContext";

/**
 * Global "read aloud" mini player — a small floating pill, same visual
 * language as the app's other floating dock (see FloatingPanel.tsx), fixed
 * to the bottom of the viewport so it never collides with the top dock.
 * Lives at the app root (mounted in AppProviders) so it shows up on every
 * page while a message is being read, and keeps playing across navigation.
 */
export function ReadAloudMiniPlayer() {
  const { playingId, loadingId, isPaused, label, togglePause, stop } = useTTSContext();
  const active = playingId !== null || loadingId !== null;
  const isLoading = loadingId !== null && playingId === null;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="read-aloud-mini-player"
          role="status"
          aria-label="Read aloud"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-toast flex justify-center"
        >
          <div className="pointer-events-auto flex h-9 max-w-[min(360px,calc(100vw-32px))] items-center gap-2 rounded-full border border-surface-border bg-surface-base/90 pl-3 pr-1.5 shadow-lg backdrop-blur-xl">
            {isLoading ? (
              <span className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-muted border-t-transparent" />
            ) : (
              <SpeakerHigh size={14} weight="bold" className="flex-shrink-0 text-secondary" />
            )}

            <span className="min-w-0 flex-1 truncate text-xs text-secondary">
              {isLoading ? "Preparing to read…" : (label ?? "Reading aloud")}
            </span>

            <button
              type="button"
              onClick={togglePause}
              disabled={isLoading}
              aria-label={isPaused ? "Resume" : "Pause"}
              title={isPaused ? "Resume" : "Pause"}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-primary disabled:opacity-40"
            >
              {isPaused ? <Play size={12} weight="fill" /> : <Pause size={12} weight="fill" />}
            </button>

            <button
              type="button"
              onClick={stop}
              aria-label="Stop reading"
              title="Stop reading"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
