import { defineIcon, type Glyph } from '@/components/icons/Icon'
import type { IconSize } from '@/design/tokens'
import { type ProjectIcon } from '@/domain/projects/types'

/**
 * Project marks.
 *
 * ---- Why none of these is a picture of anything --------------------------
 *
 * The obvious set is a cube, a flask, a leaf, a compass. It is also the wrong
 * set, and not because those were drawn badly — a literal object is the dated
 * idea itself. Pictorial marks carry meaning the user did not ask for: a flask
 * says the project is an experiment, a leaf says it is small or new, and the
 * user picking one to tell two projects apart ends up making a claim about the
 * work. Worse, a rail of little objects reads as a sticker sheet no matter how
 * carefully each one is drawn, because the eye is being asked to identify eight
 * different *things* rather than to distinguish eight labels.
 *
 * These are abstract instead: arcs, a stack, a grid, a ring, a wave, a burst, a
 * triangle, a diamond. None of them means anything, which is the requirement.
 * They differ by silhouette rather than subject, so they are still instantly
 * distinguishable at 14px in a rail — and being pure geometry, they sit in the
 * same visual family as the interface around them instead of decorating it.
 *
 * This is also why the registry's uniqueness rule does not reach here: a mark
 * that means nothing cannot collide with a concept.
 */
const MARKS: Record<ProjectIcon, Glyph> = {
  arc: {
    p: ['M3 11.6a5 5 0 0 1 10 0', 'M4.8 11.6a3.2 3.2 0 0 1 6.4 0'],
    fc: [[8, 11.6, 1.05]],
  },
  stack: {
    r: [[2.5, 3.3, 11, 2.7, 1.35], [3.9, 6.65, 8.2, 2.7, 1.35], [5.3, 10, 5.4, 2.7, 1.35]],
  },
  grid: {
    r: [[2.6, 2.6, 4.8, 4.8, 1.5], [8.6, 2.6, 4.8, 4.8, 1.5], [2.6, 8.6, 4.8, 4.8, 1.5]],
    fr: [[8.6, 8.6, 4.8, 4.8, 1.5]],
  },
  ring: {
    c: [[7.4, 8.6, 4.6]],
    fc: [[12.5, 3.5, 1.5]],
  },
  wave: {
    p: ['M2.3 6.3q1.35-1.85 2.7 0t2.7 0 2.7 0 2.7 0', 'M2.3 10.6q1.35-1.85 2.7 0t2.7 0 2.7 0 2.7 0'],
  },
  burst: {
    l: [[8, 2.6, 8, 13.4], [3.3, 5.3, 12.7, 10.7], [3.3, 10.7, 12.7, 5.3]],
  },
  prism: {
    p: ['M8 2.5 14 13H2Z'],
    l: [[8, 2.5, 8, 13]],
  },
  diamond: {
    p: ['M8 2.2 13.8 8 8 13.8 2.2 8Z', 'M8 5.7 10.3 8 8 10.3 5.7 8Z'],
  },
}

/**
 * A mark is an identity, not a control, so it does not react to the pointer on
 * its own — the row it sits in owns the highlight. It lifts very slightly with
 * that row, which is enough to tie the two together without the mark competing
 * with the title beside it.
 */
const LIFT = { rest: { scale: 1 }, hover: { scale: 1.07, transition: { type: 'spring', stiffness: 420, damping: 26 } } } as const

const COMPONENTS = Object.fromEntries(
  Object.entries(MARKS).map(([name, glyph]) => [name, defineIcon({ ...glyph, m: LIFT }, `mark:${name}`)]),
) as Record<ProjectIcon, ReturnType<typeof defineIcon>>

export function ProjectIconMark({
  icon,
  size = 'text',
  className,
}: {
  icon: ProjectIcon
  size?: IconSize
  className?: string
}) {
  const Mark = COMPONENTS[icon]
  return <Mark size={size} className={className} />
}
