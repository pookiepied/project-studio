import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { SPRING_SNAPPY } from "../../design/tokens";
import { cn } from "../../lib/cn";

interface SegmentedOption<T extends string | number> {
  readonly id: T;
  readonly label: ReactNode;
}

/**
 * A segmented control: one choice from a small fixed set.
 *
 * This replaces a row of loose chips for the time window. Chips are the right
 * shape for the filters below it — those are independent toggles, any number of
 * them can be off, and the set changes with the data. A window is none of
 * those things: it is exactly one of three, always, and drawing it as three
 * separate buttons made an exclusive choice look like three optional ones.
 *
 * The selected thumb is a shared layout animation rather than a background
 * class, so moving between options slides one object instead of one fading out
 * while another fades in. That is the difference between a control that feels
 * like a switch and one that feels like three buttons.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  /** Distinguishes this control's thumb from any other on screen. */
  layoutId,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      // `sm` rows inside an `lg` track with 2px of padding: near enough the
      // concentric rule at this size that the corners stay parallel.
      className={cn("inline-flex gap-0.5 rounded-lg bg-surface-sunken p-0.5", className)}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "text-caption relative flex items-center justify-center rounded-md px-2.5",
              "h-(--control-sm) transition-colors duration-fast",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className="absolute inset-0 rounded-md bg-surface shadow-chip"
              />
            ) : null}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
