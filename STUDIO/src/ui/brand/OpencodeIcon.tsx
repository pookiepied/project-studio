/**
 * OpencodeIcon
 *
 * Mark for the opencode CLI (sst/opencode). A `</>` code-bracket glyph on a
 * rounded badge — reads instantly as "code" at small sizes in the tab launcher.
 *
 * Colour: #A855F7 — opencode's violet.
 */

// eslint-disable-next-line no-restricted-syntax -- opencode brand colour; no neutral-token equivalent (§17 brand carve-out)
const BRAND = "#A855F7";

interface OpencodeIconProps {
  size?: number;
  className?: string;
}

export function OpencodeIcon({ size = 16, className }: OpencodeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" fill={BRAND} />
      <path
        d="M9.2 8.2 6 11.4c-.3.3-.3.8 0 1.1l3.2 3.2"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 8.2 18 11.4c.3.3.3.8 0 1.1l-3.2 3.2"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.1 7.4 10.9 16.6"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
