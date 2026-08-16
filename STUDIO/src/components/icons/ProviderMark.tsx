import { siAnthropic, siDeepseek, siGooglegemini, siMeta, siMistralai } from 'simple-icons'
import { ICON, type IconSize } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * Provider marks -- the real brand logos, drawn in one colour.
 *
 * ---- Why Simple Icons ------------------------------------------------------
 *
 * These were our own geometric stand-ins, which was the safe choice and the
 * wrong one: a provider mark's whole job is to be recognised before it is read,
 * and an abstract figure standing in for Anthropic is recognisable to nobody.
 * Simple Icons ships each brand as a single path on a 24-unit grid with no
 * baked-in colour, which is exactly the shape this app can use -- the mark
 * inherits `currentColor` like every other glyph, so a picker built from them
 * still reads as one list rather than a strip of brand assets.
 *
 * Each icon is imported by name so the bundler drops the other three thousand.
 *
 * ---- What this does not solve ---------------------------------------------
 *
 * The icons are CC0, but a logo is a trademark and CC0 does not touch that.
 * Using a mark to identify the provider a model comes from is nominative use
 * and is the ordinary case, but it is not licence to put these on marketing, an
 * app icon, or anything implying endorsement.
 *
 * ---- OpenAI ----------------------------------------------------------------
 *
 * Absent from Simple Icons, removed at OpenAI's own request, so there is no
 * mark to import and drawing the knot ourselves would reproduce the trademark
 * the removal was about. It keeps a geometric stand-in, and that is a
 * deliberate mismatch rather than an oversight: one abstract mark in a row of
 * real ones is visible, but inventing a lookalike is the kind of thing that has
 * to be undone later, publicly. `custom` is a stand-in for the same reason --
 * there is no brand to show.
 */

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'meta' | 'deepseek' | 'mistral' | 'custom'

/**
 * A brand path, or `null` for the marks we draw ourselves.
 *
 * Google resolves to the Gemini mark rather than the four-colour "G": the "G"
 * is the company, and what is being named here is the model family. Gemini is
 * also legible as one colour, which the multi-colour logo is not.
 */
const BRAND: Record<ProviderId, string | null> = {
  anthropic: siAnthropic.path,
  google: siGooglegemini.path,
  meta: siMeta.path,
  deepseek: siDeepseek.path,
  mistral: siMistralai.path,
  openai: null,
  custom: null,
}

/**
 * Drawn marks, for the two providers with no importable logo.
 *
 * Stroked rather than filled, on the same 24-unit grid as the brand paths, so
 * they sit at a similar optical weight beside them.
 */
const DRAWN: Record<'openai' | 'custom', React.ReactNode> = {
  // A ring with a gap -- a node in a loop. Deliberately not the OpenAI knot.
  openai: (
    <path
      d="M20.4 12a8.4 8.4 0 1 1-4.1-7.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  // Anything self-hosted or user-added.
  custom: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8.6v6.8M8.6 12h6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
  const brand = BRAND[provider]

  return (
    <svg
      style={{ width: box, height: box }}
      viewBox="0 0 24 24"
      aria-hidden
      shapeRendering="geometricPrecision"
      className={cn('studio-icon shrink-0', className)}
    >
      {brand ? (
        // The brand paths are solid shapes, so they fill rather than stroke --
        // and they must not inherit the `non-scaling-stroke` treatment meant for
        // outlined marks, which is why `stroke` is explicitly none.
        <path d={brand} fill="currentColor" stroke="none" />
      ) : (
        DRAWN[provider as 'openai' | 'custom']
      )}
    </svg>
  )
}
