import { motion, type Transition } from 'framer-motion'
import { EASE_OUT } from '@/design/tokens'

/**
 * The Studio mark: five rounded tiles descending in a staircase.
 *
 * Draws in `currentColor`, so it inherits text colour and works in both themes
 * without a second asset. This is the brand rather than system chrome, so the
 * monochrome rule does not constrain it -- it simply happens not to need a hue.
 *
 * `busy` ripples the tiles to signal work in flight. It reads as active without
 * spinning, and it is the same glyph at rest, so nothing jumps when a turn
 * starts or ends.
 *
 * `entrance` is the one-shot assembly for the splash screen: the tiles stagger
 * in top to bottom, in the order the staircase is read, so the mark arrives
 * already descending.
 */

const TILE = { size: 25, radius: 5.5 } as const

/** Tile origins on the 96x128 canvas, top to bottom. */
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

function tileMotion(index: number, busy: boolean, entrance: boolean): TileMotion {
  if (!busy && !entrance) {
    return {
      initial: false,
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0.48, ease: EASE_OUT },
    }
  }

  if (entrance) {
    return {
      initial: { opacity: 0, scale: 0.82 },
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0.48, delay: 0.12 + index * 0.14, ease: EASE_OUT },
    }
  }

  // The trough stays well above invisible: this is a shimmer travelling down
  // the mark, not tiles disappearing and returning.
  return {
    initial: { opacity: 1, scale: 1 },
    animate: { opacity: [0.62, 1, 0.62], scale: [0.94, 1, 0.94] },
    transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: index * 0.12 },
  }
}

export function StudioMark({
  busy = false,
  entrance = false,
  size = 16,
  className,
}: {
  busy?: boolean
  /** One-shot staggered assembly -- the splash entrance. */
  entrance?: boolean
  /** Rendered height in px; the mark keeps its 3:4 ratio. */
  size?: number
  className?: string
}) {
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
        const props = tileMotion(index, busy, entrance)
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
            initial={props.initial}
            animate={props.animate}
            transition={props.transition}
          />
        )
      })}
    </svg>
  )
}
