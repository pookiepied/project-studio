import { motion, AnimatePresence } from "framer-motion";
import { WifiSlashIcon as WifiSlash, ArrowsClockwiseIcon as ArrowsClockwise } from "@phosphor-icons/react";
import { useOffline } from "../../contexts/OfflineContext";

const Tear = ({ x, delay }: { x: number; delay: number }) => (
  <motion.div
    className="absolute top-[52px] pointer-events-none"
    style={{ left: `calc(50% + ${x}px)` }}
    initial={{ y: 0, opacity: 0, scaleY: 1 }}
    animate={{ y: [0, 0, 28], opacity: [0, 0.7, 0], scaleY: [1, 1.3, 0.8] }}
    transition={{
      repeat: Infinity,
      duration: 1.8,
      delay,
      ease: "easeIn",
      times: [0, 0.15, 1],
    }}
  >
    <div className="w-1.5 h-2 bg-surface-active rounded-full" />
  </motion.div>
);

export const OfflineModal = () => {
  const { showOfflineModal, checkConnectivity } = useOffline();

  const handleTryAgain = async () => {
    await checkConnectivity();
  };

  return (
    <AnimatePresence>
      {showOfflineModal && (
        <motion.div
          key="offline-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-modal flex items-center justify-center bg-surface-page transition-colors duration-normal"
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center text-center gap-7 max-w-[280px] px-4"
          >
            <div className="relative flex items-center justify-center">
              {/* Soft glow halo */}
              <motion.div
                animate={{ scale: [1, 1.18, 1], opacity: [0.25, 0.1, 0.25] }}
                transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
                className="absolute w-28 h-28 rounded-full bg-surface-border blur-2xl"
              />

              {/* Face */}
              <motion.div
                animate={{ y: [0, -9, 0], rotate: [-1.5, 1.5, -1.5] }}
                transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                className="relative w-[72px] h-[72px] rounded-full bg-surface-raised border border-surface-border flex items-center justify-center"
              >
                {/* Eyes — decorative mid-gray dots; no semantic surface maps exactly */}
                <div className="absolute top-[22px] left-[18px] w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
                <div className="absolute top-[22px] right-[18px] w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
                {/* Sad mouth */}
                <svg className="absolute bottom-[17px]" width="22" height="10" viewBox="0 0 22 10" fill="none">
                  <path d="M2 2 Q11 10 20 2" style={{ stroke: "var(--text-muted)" }} strokeWidth="2" strokeLinecap="round" />
                </svg>
              </motion.div>

              <Tear x={-8} delay={0.2} />
              <Tear x={8}  delay={1.1} />

              {/* WiFi-slash badge */}
              <motion.div
                animate={{ y: [0, -9, 0] }}
                transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-surface-border border border-surface-border flex items-center justify-center"
              >
                <WifiSlash size={11} weight="regular" className="text-muted" />
              </motion.div>
            </div>

            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-primary font-sans tracking-tight">
                No internet connection
              </h1>
              <p className="text-sm text-muted leading-relaxed">
                Check your connection. We'll reconnect automatically when you're back online.
              </p>
            </div>

            <button
              onClick={handleTryAgain}
              className="flex items-center gap-1 text-sm text-muted hover:text-secondary transition-colors duration-fast"
            >
              <ArrowsClockwise size={11} weight="regular" />
              Try again
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
