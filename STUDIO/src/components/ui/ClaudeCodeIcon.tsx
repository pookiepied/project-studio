/**
 * ClaudeCodeIcon
 *
 * Pixel-art robot that is the official Anthropic Claude Code mascot.
 * Transcribed as SVG from the Claude Code brand asset.
 *
 * Anatomy (14×14 viewBox, 1 unit = 1 pixel-art "pixel"):
 *   • Rectangular head/body with two rectangular eye cutouts
 *   • Two arm protrusions from the body sides (vertically centred)
 *   • Four evenly-spaced legs hanging from the bottom
 *
 * Color: #CC785C — Anthropic's signature terracotta/salmon.
 * Eyes:  white — same as the original brand asset.
 *
 * When `busy` is set the four legs ripple in sequence (a walking/typing
 * shimmer) while the body stays put — reads as "working" without swinging the
 * whole glyph. Idle = completely still.
 *
 * Usage:
 *   <ClaudeCodeIcon size={18} />
 *   <ClaudeCodeIcon size={20} className="opacity-80" />
 *   <ClaudeCodeIcon size={16} busy />
 */

import { motion } from "framer-motion";

interface ClaudeCodeIconProps {
  /** Rendered width and height in px (icon is square). Default: 16 */
  size?: number;
  className?: string;
  /** Loop the "working" leg ripple. Default: false (static). */
  busy?: boolean;
}

/** Primary Claude Code brand terracotta — #CC785C */
// eslint-disable-next-line no-restricted-syntax -- Anthropic brand colour; no neutral-token equivalent (§17 brand carve-out)
const BRAND = "#CC785C";

const LEG_X = [1.5, 4.5, 7.5, 10.5] as const;

export function ClaudeCodeIcon({ size = 16, className, busy = false }: ClaudeCodeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* ── Body / head ─────────────────────────────────────────────────── */}
      <rect x="1"   y="1"   width="12" height="7"   fill={BRAND} />

      {/* ── Arms — protrude from body sides, vertically centred ─────────── */}
      <rect x="0"   y="3.5" width="1"  height="2.5" fill={BRAND} />
      <rect x="13"  y="3.5" width="1"  height="2.5" fill={BRAND} />

      {/* ── Eyes — white rectangular cutouts at ~¼ and ¾ of body width ─── */}
      <rect x="3"   y="2"   width="2"  height="3"   fill="white" />
      <rect x="9"   y="2"   width="2"  height="3"   fill="white" />

      {/* ── Legs — four evenly-spaced; ripple in sequence while busy ─────── */}
      {LEG_X.map((x, i) => (
        <motion.rect
          key={x}
          x={x}
          y={8}
          width={2}
          height={4}
          fill={BRAND}
          style={{ transformBox: "fill-box", transformOrigin: "top" }}
          animate={busy ? { scaleY: [1, 0.72, 1], opacity: [1, 0.72, 1] } : { scaleY: 1, opacity: 1 }}
          transition={busy
            ? { duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }
            : { duration: 0.2 }}
        />
      ))}
    </svg>
  );
}
