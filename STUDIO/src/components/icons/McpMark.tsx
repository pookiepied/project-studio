import type { CSSProperties } from 'react'
import { ICON_STEP, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The Model Context Protocol's own mark.
 *
 * Not a Lucide stand-in. MCP has a published logo and this is it, taken from
 * `modelcontextprotocol/modelcontextprotocol` (`docs/logo/light.svg`) with the
 * wordmark dropped and the three glyph paths kept exactly as drawn.
 *
 * **Why this is a component rather than a `defineIcon` glyph.** The drawn set
 * describes marks on a 16-unit grid, which is what keeps our own icons
 * consistent with each other. These paths are cubic curves on a 195-unit
 * canvas, and re-drawing them onto that grid would mean redrawing somebody
 * else's brand by hand and getting it slightly wrong. A logo is the one kind
 * of mark that should be copied rather than interpreted, so the original
 * geometry is kept and only the colour is ours.
 *
 * **The stroke is 1.2, not the logo's own 12, and the difference is not a
 * judgement call.** `.studio-icon` applies `vector-effect: non-scaling-stroke`
 * so that every mark paints the same weight at every size, which means the
 * number is read in DEVICE PIXELS and the viewBox scale stops applying to it.
 * The logo's 12 is 12 units of 195; left as it was it painted a 12-PIXEL
 * stroke into a 13-pixel icon, which floods the box solid -- the mark rendered
 * as a filled square. 1.2 is what the rest of the set uses, so the geometry
 * stays the logo's and only the ink weight joins the family.
 */
export function McpMark({
  size = 'text',
  className,
  style,
}: {
  size?: IconSize
  className?: string
  style?: CSSProperties
}) {
  const box = size === 'text' ? '1.1em' : ICON_STEP[size]
  return (
    <svg
      aria-hidden
      viewBox="0 0 195 195"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      className={cn('studio-icon shrink-0', className)}
      style={{ width: box, height: box, ...style }}
    >
      <path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706V29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177" />
      <path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L99.7248 159.6C96.6006 162.724 96.6006 167.789 99.7248 170.913L112.331 183.52" />
      <path d="M109.853 46.9411L59.6482 97.1457C50.2757 106.518 50.2757 121.714 59.6482 131.087V131.087C69.0208 140.459 84.2168 140.459 93.5894 131.087L143.794 80.8822" />
    </svg>
  )
}
McpMark.displayName = 'mcp'
