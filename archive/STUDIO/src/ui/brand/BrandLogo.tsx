/**
 * BrandLogo — generic brand-mark primitive backed by simple-icons + monogram fallback.
 *
 * The single rendering mechanism for all logo-in-a-badge call-sites (DOC §17 step 5).
 * Consumers that have provider/slug routing logic (ProviderIcon, ProjectLauncher in T3.5,
 * MCP/extension logos in T3.5+) delegate the badge rendering here.
 *
 * Multi-color brand marks are the documented exception to the currentColor rule (see
 * 03-DECISIONS-AND-CAVEATS D-304 / §17). simple-icons paths are inherently monochrome
 * (currentColor fill); hardcoded brand hex is a separate "brand" category — do NOT add
 * brand-specific colour logic here.
 */

export type BrandLogoSize = "xs" | "sm" | "md";

const PX: Record<BrandLogoSize, number> = { xs: 11, sm: 13, md: 15 };

const BADGE: Record<BrandLogoSize, string> = {
  xs: "w-5 h-5 text-3xs rounded-md",
  sm: "w-6 h-6 text-3xs rounded-md",
  md: "w-7 h-7 text-3xs rounded-lg",
};

interface BrandLogoProps {
  /** SVG `d` path from simple-icons (e.g. `siAnthropic.path`). Renders the mark. */
  path?: string;
  /** 2-3 char fallback text shown when no `path` is provided. */
  monogram: string;
  /** Accessible label for the badge (provider/app display name). */
  label: string;
  size?: BrandLogoSize;
  className?: string;
}

export function BrandLogo({
  path,
  monogram,
  label,
  size = "sm",
  className = "",
}: BrandLogoProps) {
  const px = PX[size];
  return (
    <span
      title={label}
      aria-label={label}
      className={`
        inline-flex items-center justify-center flex-shrink-0
        ${BADGE[size]}
        bg-surface-raised border border-surface-border
        text-muted transition-colors duration-normal
        ${className}
      `}
    >
      {path ? (
        <svg
          viewBox="0 0 24 24"
          width={px}
          height={px}
          fill="currentColor"
          aria-hidden="true"
          className="flex-shrink-0"
        >
          <path d={path} />
        </svg>
      ) : (
        <span className="font-semibold leading-none tracking-wide">
          {monogram}
        </span>
      )}
    </span>
  );
}
