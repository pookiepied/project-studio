import type { ReactNode } from "react";

/**
 * Feature-private settings row: label + description + control.
 *
 * Layout differs from the generic `components/ui/SettingsRow` (which uses a
 * right-aligned flex layout) — this one stacks on small screens and renders a
 * bottom border between rows (mobile/responsive density the settings screen
 * was built around). Kept feature-private to avoid a visual regression (D-405)
 * rather than collapsing onto the generic primitive.
 *
 * Tokenized: surface/text/divider via semantic tokens; the token system handles
 * light→dark switches, so per-element `transition-colors duration-300` artifacts
 * are dropped.
 */
interface SettingsRowProps {
  label: string;
  description?: string;
  control: ReactNode;
  className?: string;
}

export const SettingsRow = ({
  label,
  description,
  control,
  className = "",
}: SettingsRowProps) => (
  <div
    className={`flex flex-col gap-3 py-4 border-b border-surface-divider sm:flex-row sm:items-center sm:justify-between ${className}`}
  >
    <div className="flex-1 sm:pr-6">
      <p className="text-sm font-normal text-secondary">{label}</p>
      {description && (
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      )}
    </div>
    {control}
  </div>
);
