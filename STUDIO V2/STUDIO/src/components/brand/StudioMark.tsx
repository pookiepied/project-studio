import { motion, type Transition } from 'framer-motion'

/**
 * The STUDIO mark: five rounded tiles descending in a staircase.
 *
 * It draws in `currentColor`, so it inherits text colour and works in both
 * themes without a second asset — unlike the raster/SVG brand files, which
 * carry their own dark fill and border.
 *
 * `busy` is the working state: each tile breathes in sequence so a wave ripples
 * down the mark. It reads as active without spinning, and it is the same glyph
 * at rest, so nothing jumps when a turn starts or ends.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const
const TILE = { size: 25, radius: 5.5 } as const

/** Tile origins on the 96×128 canvas, top to bottom. */
const TILES = [
  { x: 25, y: 8 },
  { x: 47, y: 30 },
  { x: 25, y: 52 },
  { x: 47, y: 74 },
  { x: 25, y: 96 },
] as const

interface TileMotion {
  initial: false | { opacity: number; scale: number }
  animate: { opacity: number | number[]; scale: number | number[] }
  transition: Transition
}

function tileMotion(index: number, busy: boolean): TileMotion {
  if (!busy) {
    return {
      initial: false,
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0.48, ease: EASE_OUT },
    }
  }

  // The trough stays well above invisible: this is a shimmer travelling down
  // the mark, not tiles disappearing and returning.
  return {
    initial: { opacity: 1, scale: 1 },
    animate: { opacity: [0.62, 1, 0.62], scale: [0.94, 1, 0.94] },
    transition: {
      duration: 1.4,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: index * 0.12,
    },
  }
}

interface StudioMarkProps {
  /** Ripple the tiles to signal a turn in flight. */
  busy?: boolean
  /** Rendered height in px; the mark keeps its 3:4 ratio. */
  size?: number
  className?: string
}

export function StudioMark({ busy = false, size = 16, className }: StudioMarkProps) {
  return (
    <svg
      height={size}
      width={(size * 96) / 128}
      viewBox="0 0 96 128"
      fill="none"
      aria-hidden
      shapeRendering="geometricPrecision"
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      {TILES.map((tile, index) => {
        const motionProps = tileMotion(index, busy)
        return (
          <motion.rect
            key={tile.y}
            x={tile.x}
            y={tile.y}
            width={TILE.size}
            height={TILE.size}
            rx={TILE.radius}
            fill="currentColor"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            initial={motionProps.initial}
            animate={motionProps.animate}
            transition={motionProps.transition}
          />
        )
      })}
    </svg>
  )
}
