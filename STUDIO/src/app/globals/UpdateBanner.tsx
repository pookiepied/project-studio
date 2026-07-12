/**
 * UpdateBanner — floating update notification card, Tauri-only.
 * Tokenized onto the neutral surface system. Emphasis CTA uses the sanctioned
 * inverted-emphasis tokens (bg-primary + text-on-emphasis + hover:bg-secondary),
 * matching the Button primitive's "primary" variant. Status is colorless (§11.3).
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowCircleUpIcon as ArrowCircleUp,
  SpinnerIcon as Spinner,
  CheckCircleIcon as CheckCircle,
  XIcon as X,
} from "@phosphor-icons/react";
import { useAppUpdater } from "@/app/hooks/useAppUpdater";
import { environmentService } from "@/core/platform/environmentService";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

export const UpdateBanner = () => {
  const isTauri = environmentService.isTauri();
  const { state, install, dismiss } = useAppUpdater();

  if (!isTauri) return null;

  const visible =
    state.status === "available" ||
    state.status === "downloading" ||
    state.status === "ready";

  return (
    <div className="fixed bottom-5 right-5 z-toast pointer-events-none">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="w-72 bg-surface-base border border-surface-border rounded-2xl shadow-xl overflow-hidden pointer-events-auto"
          >
            <div className="px-4 pt-4 pb-4 space-y-3">

              {state.status === "available" && (
                <>
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0 mt-0.5">
                      <ArrowCircleUp size={16} weight="fill" className="text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary leading-tight">
                        Update available
                      </p>
                      <p className="text-xs text-muted mt-0.5 font-mono">
                        v{state.version}
                      </p>
                    </div>

                    <IconButton
                      onClick={dismiss}
                      aria-label="Dismiss"
                      className="h-auto w-auto shrink-0 mt-0.5 text-disabled hover:bg-transparent hover:text-muted"
                    >
                      <X size={14} weight="regular" />
                    </IconButton>
                  </div>

                  {state.notes && (
                    <p className="text-xs text-muted leading-relaxed pl-10 line-clamp-2">
                      {state.notes}
                    </p>
                  )}

                  <Button
                    onClick={install}
                    className="w-full h-auto rounded-xl px-3 py-2.5 text-xs font-semibold"
                  >
                    Install &amp; Restart
                  </Button>
                </>
              )}

              {state.status === "downloading" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0">
                      <Spinner size={14} weight="regular" className="text-secondary animate-spin" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary leading-tight">
                        Installing…
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        {state.progress}% complete
                      </p>
                    </div>
                  </div>

                  <div className="h-1 bg-surface-hover rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${state.progress}%` }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                  </div>
                </div>
              )}

              {/* Colorless success per §11.3 — neutral surface + filled check, no green */}
              {state.status === "ready" && (
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0">
                    <CheckCircle size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary leading-tight">
                      Update complete
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      Restarting app…
                    </p>
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
