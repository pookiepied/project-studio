/**
 * OpencodeIcon
 *
 * Official OpenCode logo (from opencode.ai/favicon.svg). A geometric "O"-like
 * shape with a rectangular cutout, rendered on a dark rounded badge.
 *
 * Colour: #131010 — OpenCode's brand near-black background.
 */

import type { ComponentType } from "react";

// eslint-disable-next-line no-restricted-syntax -- OpenCode brand colour; no semantic-token equivalent (§17 brand carve-out)
const BRAND = "#131010";

// eslint-disable-next-line no-restricted-syntax -- OpenCode brand colours; no semantic-token equivalent (§17 brand carve-out)
const INNER = "#5A5858";

interface OpencodeIconProps {
  size?: number;
  className?: string;
}

export const OpencodeIcon: ComponentType<{ size?: number; className?: string }> = function OpencodeIcon({ size = 16, className }: OpencodeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="112" fill={BRAND} />
      <path
        d="M320 224V352H192V224H320Z"
        fill={INNER}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
        fill="white"
      />
    </svg>
  );
};
