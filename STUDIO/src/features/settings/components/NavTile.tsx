import type { ReactNode } from "react";
import { Collapse } from "@/ui/icons";

/**
 * Navigation tile (a section entry on the settings landing menu). Tokenized
 * onto the §11.1 channel-separated state model: rest = base surface; hover =
 * the quietest fill only; selected = stronger fill + emphasis (not used here).
 *
 * Kept as a raw `<button>` (a card-as-button) — no primitive fits a full-width
 * navigational card. Same precedent as the activity `ProviderCard` (C-401).
 */
interface NavTileProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  className?: string;
}

export const NavTile = ({
  icon,
  title,
  subtitle,
  onClick,
  className = "",
}: NavTileProps) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center justify-between py-3.5 px-3 -mx-3 rounded-xl hover:bg-surface-hover transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page group ${className}`}
  >
    <div className="flex items-center gap-3.5">
      <span className="text-muted flex-shrink-0">{icon}</span>
      <div className="text-left">
        <p className="text-sm text-secondary group-hover:text-primary transition-colors duration-fast ease-standard">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      </div>
    </div>
    <Collapse
      size="sm"
      weight="regular"
      aria-hidden="true"
      className="text-disabled flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-fast ease-standard"
    />
  </button>
);
