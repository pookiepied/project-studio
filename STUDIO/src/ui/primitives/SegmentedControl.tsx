import type { ReactNode } from "react";

/**
 * SegmentedControl — a small set of mutually-exclusive options rendered as a
 * single inline track (iOS-style segmented picker).
 *
 * Introduced in Phase 4 (C-401) once the "pill toggle" pattern recurred across
 * features (activity mode tabs, manage Static/Dynamic router toggle). Use this
 * instead of hand-rolling a row of `<button>`s.
 *
 * Design-system notes:
 *   • Strict-neutral (D-401): selection reads on surface + weight, never hue —
 *     the active segment uses `bg-surface-selected` + `text-primary` (the
 *     sanctioned "selected" treatment), inactive segments are `text-muted`.
 *   • A11y: the track is a `radiogroup`; each segment is a `radio`. Pass a
 *     descriptive `aria-label` for the group.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional leading glyph (use the icon barrel: `<Refresh size="xs" />`). */
  icon?: ReactNode;
  /** Accessible name when `label` is not plain readable text. */
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  "aria-label": string;
  className?: string;
}

const sizeClasses = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
} as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  disabled = false,
  "aria-label": ariaLabel,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 rounded-lg bg-surface-base p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={opt.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40 ${sizeClasses[size]} ${
              isActive
                ? "bg-surface-selected text-primary"
                : "text-muted hover:text-secondary"
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
