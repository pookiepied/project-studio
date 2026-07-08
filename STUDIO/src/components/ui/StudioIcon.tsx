/**
 * StudioIcon
 *
 * STUDIO's own brand mark — the same `/logo.png` used on the login / welcome
 * screens. Mirrors ClaudeCodeIcon's API (size, className) so the two engines
 * read as siblings in the EngineSelector instead of one having a real logo and
 * the other a placeholder circle.
 */

interface StudioIconProps {
  /** Rendered width and height in px (icon is square). Default: 16 */
  size?: number;
  className?: string;
}

export function StudioIcon({ size = 16, className }: StudioIconProps) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={`object-contain ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}
