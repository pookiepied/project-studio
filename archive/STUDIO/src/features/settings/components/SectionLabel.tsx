import type { ReactNode } from "react";

/**
 * Section label (e.g. "MODELS", "AUDIO"). A small uppercase heading with an
 * optional leading glyph. Feature-private shared helper for the settings UI.
 *
 * Uses semantic tokens (no raw `gray-*`/`dark:` / theme transitions); the
 * token system handles theming so per-element `transition-colors duration-300`
 * theme-switch artifacts are dropped.
 */
interface SectionLabelProps {
  icon: ReactNode;
  title: string;
  className?: string;
}

export const SectionLabel = ({ icon, title, className = "" }: SectionLabelProps) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <span className="text-secondary">{icon}</span>
    <h2 className="text-2xs font-semibold font-sans uppercase tracking-extra-wide text-muted">
      {title}
    </h2>
  </div>
);
