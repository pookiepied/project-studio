import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * SidebarOutline — panel toggle glyph, inspired by `archive/STUDIO/src/ui/icons/WorkspaceIcons.tsx:NavToggleIcon`
 * but as a proper **sidebar/workspace** icon.
 *
 * - Outer rounded rect + internal divider (so it reads as "sidebar" / "workspace",
 *   not a plain box). The *external* decorative line that was rendered
 *   **beside** each toggle (sibling `border`/`Separator`) has been removed —
 *   that's the Task 1 "line beside each sidebar icon" fix.
 * - Metrics are own (rx 2.5, stroke 1.25, divider at ~1/3) so it's inspired,
 *   not a direct copy of the reference `rect(2.5,2.5,11,11,rx3)+line(6.2)` .
 * - Same size scale (`xs`/`sm`/`md`/`lg`/`xl`) and Tailwind `size-*` as the
 *   Phosphor barrel, kept as a standalone component (not monolithic inline
 *   SVG in `SideRail.tsx`).
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
      {/* Outer frame */}
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" />
      {/* Internal divider — makes it read as sidebar/workspace, not plain box. */}
      <line x1="6.1" y1="2.75" x2="6.1" y2="13.25" strokeOpacity={0.95} />
    </svg>
  )
})
SidebarOutline.displayName = 'SidebarOutline'
