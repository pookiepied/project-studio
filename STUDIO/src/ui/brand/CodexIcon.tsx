/**
 * CodexIcon
 *
 * Stylised mark for OpenAI Codex CLI. OpenAI's signature emerald-green knot,
 * rendered as a clean six-arc hexafoil on a rounded badge so it reads at
 * small sizes in the tab launcher.
 *
 * Colour: #10A37F — OpenAI's brand emerald.
 */

// eslint-disable-next-line no-restricted-syntax -- OpenAI brand colour; no neutral-token equivalent (§17 brand carve-out)
const BRAND = "#10A37F";

interface CodexIconProps {
  size?: number;
  className?: string;
}

export function CodexIcon({ size = 16, className }: CodexIconProps) {
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
      {/* Stylised OpenAI hexafoil knot (white) */}
      <path
        fill="white"
        d="M12 5.2c.5-1.5 2-2.4 3.6-2 .8.2 1.5.7 1.9 1.4.6-.3 1.3-.4 2-.2 1.5.5 2.4 2 2 3.6.4.6.5 1.3.3 2 1.1 1.1 1.4 2.8.6 4.2-.5.9-1.4 1.5-2.4 1.7.1 1.6-1 3-2.6 3.3-.8.1-1.6-.1-2.2-.5-.4.7-1.1 1.2-1.9 1.4-1.6.4-3.2-.5-3.7-2-1-.1-1.9-.7-2.4-1.7-.8-1.4-.5-3.1.6-4.2-.2-.7-.1-1.4.3-2-.4-1.6.5-3.2 2-3.6.7-.2 1.4-.1 2 .2.4-.7 1.1-1.2 1.9-1.4 1.6-.4 3.1.5 3.6 2Zm-.7 1.9c-.6-.9-1.7-1.2-2.6-.7-.4.2-.7.5-.9.9l3.5 6c.6.1 1.1.5 1.4 1l2.3-1.3c.1-1 .8-1.7 1.7-2-.2-1-.8-1.7-1.7-2-.5.9-1.6 1.3-2.6 1l-1.1-2.9Zm-3.8 1.9c-1 .2-1.7.9-2 1.8.8.6 1.1 1.6.9 2.5l2.4 1.4c.5-.3 1.1-.4 1.6-.3l-2.9-5.4c-.1 0-.1 0 0 0Zm6.9 6.4c-.6.7-1.5 1-2.4.7l-.1-.1-2.3 1.3c0 1-.7 1.8-1.6 2.1.2 1 .8 1.7 1.7 2 .5-.9 1.6-1.3 2.6-1l1.1 3c.6.9 1.7 1.2 2.6.7.4-.2.7-.5.9-.9l-3.5-6c-.6-.1-1.1-.5-1.4-1l-2.3 1.3c-.1 1-.8 1.7-1.7 2 .2 1 .8 1.7 1.7 2 .5-.9 1.6-1.3 2.6-1l1.1-2.9c-.4-.4-.6-.9-.6-1.5l.1-.6Z"
      />
    </svg>
  );
}
