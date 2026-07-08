import { motion, type Transition } from "framer-motion";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

interface StudioMarkProps {
  /** One-shot staggered entrance (splash screen). */
  animated?: boolean;
  /** Looping "working" ripple — the tiles pulse in sequence down the staircase.
   *  Used by the chat status glyph while a turn is in flight. Idle = still. */
  busy?: boolean;
  className?: string;
  size?: number;
}

const TILE_SIZE = 25;
const TILE_RADIUS = 5.5;

const tiles = [
  { x: 25, y: 8 },
  { x: 47, y: 30 },
  { x: 25, y: 52 },
  { x: 47, y: 74 },
  { x: 25, y: 96 },
] as const;

function tileMotion(index: number, animated: boolean, busy: boolean): {
  initial: false | { opacity: number; scale: number };
  animate: { opacity: number | number[]; scale: number | number[] };
  transition: Transition;
} {
  // "Working": each tile breathes opacity + scale, offset by its position so a
  // wave ripples down the mark and loops. This reads as active far better than
  // rocking the whole glyph left/right.
  if (busy) {
    // Stay clearly visible at the trough — a gentle shimmer, not a
    // disappear-and-return. Min opacity is high enough that no tile ever reads
    // as "hidden".
    return {
      initial: { opacity: 1, scale: 1 },
      animate: { opacity: [0.62, 1, 0.62], scale: [0.94, 1, 0.94] },
      transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: index * 0.12 },
    };
  }
  // Splash entrance — one-shot stagger in.
  if (animated) {
    return {
      initial: { opacity: 0, scale: 0.82 },
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0.48, delay: 0.12 + index * 0.14, ease: EASE_OUT },
    };
  }
  // Static.
  return {
    initial: false,
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.48, ease: EASE_OUT },
  };
}

export function StudioMark({ animated = false, busy = false, className = "", size = 92 }: StudioMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 128"
      fill="none"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
    >
      {tiles.map((tile, index) => {
        const m = tileMotion(index, animated, busy);
        return (
          <motion.rect
            key={`tile-${tile.y}`}
            x={tile.x}
            y={tile.y}
            width={TILE_SIZE}
            height={TILE_SIZE}
            rx={TILE_RADIUS}
            fill="currentColor"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            initial={m.initial}
            animate={m.animate}
            transition={m.transition}
          />
        );
      })}
    </svg>
  );
}
