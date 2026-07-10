import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TokenRing } from "@/features/chat/components/ContextTokenRing";
import { composerRoundIconButton, cx } from "./composerControlStyles";

interface ContextWindowButtonProps {
  usedTokens: number;
  maxTokens: number;
  isSummarizing: boolean;
  hasContextSummary: boolean;
  variant?: "toolbar" | "meta";
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
}

export function ContextWindowButton({
  usedTokens,
  maxTokens,
  isSummarizing,
  hasContextSummary,
  variant = "toolbar",
}: ContextWindowButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasMeter = maxTokens > 0;
  const percentage = hasMeter ? Math.min(usedTokens / maxTokens, 1) : 0;

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!hasMeter) return null;

  return (
    <div
      className={cx(
        "relative flex h-7 shrink-0 items-center justify-center",
        variant === "meta" ? "mt-2" : "w-7",
      )}
      ref={containerRef}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Context window"
        className={cx(
          variant === "meta"
            ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full box-border leading-none text-gray-400 transition-colors dark:text-gray-600 [&>svg]:block"
            : composerRoundIconButton,
          variant === "toolbar" && "relative justify-end pr-0.5 text-gray-400",
          "hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-surface-raised dark:hover:text-gray-400",
        )}
      >
        <TokenRing
          usedTokens={usedTokens}
          maxTokens={maxTokens}
          size={10}
          stroke={1.25}
          active={usedTokens > 0}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 bottom-full mb-1.5 w-56 z-50 rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-surface-border dark:bg-surface-base"
          >
            <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
              Context window
            </p>
            <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-surface-border">
              <div
                className={`h-full rounded-full ${
                  percentage >= 0.9
                    ? "bg-surface-raised"
                    : percentage >= 0.7
                    ? "bg-surface-raised"
                    : "bg-gray-500 dark:bg-gray-400"
                }`}
                style={{ width: `${Math.round(percentage * 100)}%`, transition: "width 0.5s ease" }}
              />
            </div>
            <p className="text-2xs text-gray-400 dark:text-gray-500">
              {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)} tokens - {Math.round(percentage * 100)}%
            </p>
            {isSummarizing && (
              <p className="mt-1 text-2xs text-gray-400 dark:text-gray-500">Compacting context...</p>
            )}
            {hasContextSummary && !isSummarizing && (
              <p className="mt-1 text-2xs text-gray-400 dark:text-gray-500">Context was summarized</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
