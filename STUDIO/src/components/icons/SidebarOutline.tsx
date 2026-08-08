import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * SidebarOutline — panel toggle glyph, inspired by `archive/STUDIO/src/ui/icons/WorkspaceIcons.tsx:NavToggleIcon`
 * but **without** the internal vertical divider.
 *
 * - Same outer rounded rect concept (stroke `currentColor`, `regular` weight feel)
 * - No `<line>` element; pure outline so both rails read as open-panel controls
 * - Drawn at 16×16 viewBox to match the 11×11 rect logic, with own metrics (rx=2.5, stroke 1.25)
 *   so it is *inspired* not a direct copy of the reference SVG.
 * - Carries the same size scale (`xs`/`sm`/`md`/`lg`/`xl`) and Tailwind `size-*` class
 *   as the Phosphor barrel (`src/components/icons/index.tsx:ICON_SIZE`) so `Button`
 *   sizing stays authoritative. Kept as a standalone component for true component-based
 *   organization (not monolithic inline SVG in `SideRail.tsx`).
 */

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE = {
  xs: { px: 12, className: 'size-3' },
  sm: { px: 14, className: 'size-3.5' },
  md: { px: 16, className: 'size-4' },
  lg: { px: 20, className: 'size-5' },
  xl: { px: 24, className: 'size-6' },
} as const

interface Props extends Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: IconSize
}

export const SidebarOutline = forwardRef<SVGSVGElement, Props>(({ size = 'md', className, ...rest }, ref) => {
  const scale = SIZE[size]
  return (
    <svg
      ref={ref}
      width={scale.px}
      height={scale.px}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(scale.className, className)}
      aria-hidden="true"
      {...rest}
    >
      {/* Outer panel frame only — no internal divider line */}
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" />
    </svg>
  )
})
SidebarOutline.displayName = 'SidebarOutline'
