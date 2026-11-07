import { forwardRef, useContext } from 'react'
import { motion, type Variants } from 'framer-motion'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { complete } from '@/components/icons/fromLucide'
import { IconStateContext, type IconState } from '@/components/icons/Icon'
import { ICON_STEP, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/** A mark sits about a tenth above its text. See the note in `Icon.tsx`. */
const TEXT_RELATIVE = '1.1em'

interface HugeiconProps {
  size?: IconSize
  /** Overrides the state inherited from the surrounding control. */
  state?: IconState
  className?: string
  style?: React.CSSProperties
}

/**
 * Binds a Hugeicons mark to one of the app's concepts.
 *
 * `fromLucide`'s twin, with the same sizing and motion contract, so a call site
 * cannot tell the two apart. Every mark paints at 1.5px.
 */
export function fromHugeicons(Mark: IconSvgElement, name: string, variants?: Variants) {
  const resolved = complete(variants)

  const Concept = forwardRef<HTMLSpanElement, HugeiconProps>(function Concept(
    { size = 'text', state, className, style },
    ref,
  ) {
    const inherited = useContext(IconStateContext)
    const active = state ?? inherited
    const box = size === 'text' ? TEXT_RELATIVE : ICON_STEP[size]

    return (
      <motion.span
        ref={ref}
        aria-hidden
        initial={resolved ? 'rest' : undefined}
        animate={resolved ? active : undefined}
        variants={resolved}
        className={cn('studio-icon inline-flex shrink-0 items-center justify-center', className)}
        style={{ width: box, height: box, ...style }}
      >
        <HugeiconsIcon icon={Mark} size="100%" strokeWidth={1.5} className={`studio-mark-${name}`} />
      </motion.span>
    )
  })

  Concept.displayName = name
  return Concept
}
