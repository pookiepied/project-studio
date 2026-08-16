import { ICON, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * Provider marks.
 *
 * These are our own monochrome glyphs, not the vendors' logos. That is a
 * deliberate choice with two reasons behind it:
 *
 *   1. Redistributing a company's trademark inside a shipped, open-source app
 *      is a permission question, and one nobody wants to discover late.
 *   2. Real logos arrive with their own colours and weights, so a picker built
 *      from them is a row of mismatched brand assets. The app is monochrome and
 *      these inherit `currentColor`, so the list reads as one list.
 *
 * Each is a simple geometric figure that is distinguishable at 14px, which is
 * the only job it has here. If official assets are licensed later, this is the
 * one file that changes.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'meta' | 'deepseek' | 'mistral' | 'custom'

const PATHS: Record<ProviderId, React.ReactNode> = {
  // An ascending stack -- the same staircase idea as the Studio mark's family.
  anthropic: (
    <>
      <path d="M6 13L9.2 4h1.6L14 13" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 10.4h5" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // A ring with a gap, read as a node in a loop.
  openai: (
    <path
      d="M13.5 10a4.5 4.5 0 1 1-2.2-3.9"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
  ),
  // Four quadrants meeting at a centre.
  google: (
    <>
      <circle cx="10" cy="10" r="4.6" strokeWidth="1.6" fill="none" />
      <path d="M10 5.4v9.2M5.4 10h9.2" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // Two interlocking loops.
  meta: (
    <path
      d="M4.5 12c1.6-5 3.2-5 5.5 0s3.9 5 5.5 0"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
  ),
  // A diamond, for a mark that reads clearly at small size.
  deepseek: (
    <path d="M10 4.6 15.4 10 10 15.4 4.6 10Z" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  ),
  // A rising bar figure.
  mistral: (
    <>
      <path d="M5 14V7h3.3v7M11.7 14V7H15v7" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
      <path d="M5 7h10" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  // Anything self-hosted or user-added.
  custom: (
    <>
      <rect x="5" y="5" width="10" height="10" rx="3" strokeWidth="1.6" fill="none" />
      <path d="M10 7.8v4.4M7.8 10h4.4" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
}

export function ProviderMark({
  provider,
  size = 'text',
  className,
}: {
  provider: ProviderId
  size?: IconSize
  className?: string
}) {
  // Sized from its text like every other mark, so a provider badge beside a
  // model name matches that name rather than a step chosen at the call site.
  const box = size === 'text' ? '1.1em' : `${ICON[size]}px`
  return (
    <svg
      style={{ width: box, height: box }}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden
      shapeRendering="geometricPrecision"
      className={cn('shrink-0', className)}
    >
      {PATHS[provider]}
    </svg>
  )
}
