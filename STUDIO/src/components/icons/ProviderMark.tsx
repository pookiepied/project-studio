import { useEffect, useState } from 'react'
import { siAnthropic, siDeepseek, siGooglegemini, siMeta, siMistralai } from 'simple-icons'
import { ICON_STEP, type IconSize } from '@/design/tokens'
import { resolveProviderIcon } from '@/domain/providers/icons'
import { cn } from '@/lib/cn'

/**
 * Provider marks — the real brand logos, in the theme's own colour.
 *
 * ---- Why real logos at all -------------------------------------------------
 *
 * These were our own geometric stand-ins, which was the safe choice and the
 * wrong one: a provider mark's whole job is to be recognised before it is read,
 * and an abstract figure standing in for Anthropic is recognisable to nobody.
 *
 * ---- Why every mark is monochrome ------------------------------------------
 *
 * These wore their vendors' real colours for a while, from Simple Icons' own
 * per-brand `hex`. It was removed, and the reason is completeness rather than
 * taste.
 *
 * A colour policy cannot be finished. The table had twelve entries against a
 * catalog where most of two hundred OpenRouter authors have no logo at all,
 * let alone a colour; a self-hosted endpoint has no brand by definition and
 * never will; and a brand that is effectively black — Anthropic, OpenAI, xAI,
 * Moonshot, GitHub Copilot — cannot wear its own colour on a dark theme
 * without being invisible. The old code handled that last case by falling back
 * to the theme's foreground, which meant the vendors people actually use
 * rendered grey while Nvidia green and HuggingFace yellow did not. The colour
 * was loudest exactly where it mattered least, and the picker read as a mix of
 * identities because it was one.
 *
 * The same argument was already settled once here, in `TrafficLights`: the
 * macOS red, amber and green were removed because they would be the only
 * saturated pixels in the interface. A list of thirty vendor logos is that
 * argument at ten times the scale.
 *
 * Monochrome is completable today and stays complete for every vendor added
 * later, including ones nobody has heard of yet. It is also the safer footing
 * for what these marks are doing: naming the vendor a model came from is
 * nominative use, and a single-colour rendition claims less than a faithful
 * one. What it costs is colour as a recognition cue — acceptable because the
 * mark never appears alone. All eleven call sites put it beside the vendor or
 * model name, so it confirms an identity rather than carrying it.
 *
 * ---- Where the shapes come from --------------------------------------------
 *
 * Simple Icons ships each brand as a single path with no baked-in colour,
 * which is exactly the shape this app can use. Each is imported by name so the
 * bundler drops the other three thousand.
 *
 * The harness serves the vendors' actual logos too (models.dev, cached on
 * disk), and those SVGs are monochrome `currentColor` by design — drop one
 * into an `<img>` and it renders black everywhere, ignoring the theme. So the
 * logo is not an image here: it becomes a CSS mask on a span and the span's
 * background is `currentColor`, which puts it under the same rule as every
 * other mark in the app. A mask image cannot execute anything, so the SVG
 * needs no sanitising to be safe.
 *
 * ---- What this does not solve ---------------------------------------------
 *
 * The icons are CC0, but a logo is a trademark and CC0 does not touch that.
 * Using a mark to identify the provider a model comes from is nominative use
 * and is the ordinary case, but it is not licence to put these on marketing, an
 * app icon, or anything implying endorsement.
 *
 * ---- What a vendor with no logo gets ---------------------------------------
 *
 * Its initial, set in the interface typeface. Not an abstract glyph.
 *
 * The abstract marks this replaces were the thing that read as a placeholder,
 * and the OpenAI one was the clearest case: absent from Simple Icons, removed
 * at OpenAI's own request, so it wore a geometric stand-in that the comment
 * here used to describe as "a deliberate mismatch". One invented figure in a
 * row of real logos does not read as restraint; it reads as a missing asset.
 *
 * A monogram is the honest form. It does not pretend to be a logo, it is
 * derivable from any vendor string that will ever arrive — including ones with
 * no brand at all — and a letter is easier to tell apart at 14px than an
 * abstract figure is. It is what GitHub, Slack and Linear show for an
 * organisation whose avatar they do not have.
 *
 * Drawing the OpenAI knot ourselves is still not on the table, for the reason
 * it never was: reproducing the trademark whose removal from Simple Icons was
 * requested is the kind of thing that has to be undone later, publicly. When
 * the harness serves a real OpenAI logo, that logo is used; otherwise it is an
 * O, which claims nothing.
 */

/**
 * The vendors this app has a mark for.
 *
 * Closed, and it stays closed — it is a list of drawings we possess, not a
 * list of providers that may exist. The offline catalog in `domain/models`
 * types its rows against this because that catalog *is* these six; a harness
 * connection does not, because a user can point one at any vendor in the
 * world and most of them are not here. See `markFor` for how that gap is
 * closed at the boundary, and audit finding FE-05 for why it was a bug that
 * the two ever shared one type.
 */
const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'meta',
  'deepseek',
  'mistral',
  'custom',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

/**
 * The brand path for a vendor, or `null` when there is none to import.
 *
 * Shapes only. The colour that used to sit beside each path is gone, and with
 * it a defect worth naming: Google carried Gemini's purple here and Google's
 * blue in the colour table, so the same vendor rendered in two different
 * colours depending on whether the harness had resolved a logo yet — a
 * difference the user could not see the cause of.
 *
 * Google still resolves to the Gemini mark rather than the four-colour "G":
 * the "G" is the company, and what is being named here is the model family.
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
 * The letter a vendor with no logo is shown as.
 *
 * First letter or digit of the vendor id, which is what actually arrives here
 * — `together-ai`, `mistralai`, `the-box-next-door`. Ids are lower-case by
 * convention and a monogram is not, so it is upper-cased for display only.
 *
 * `null` when the id carries no letter at all. That is a real case rather than
 * a defensive one: `ProvidersPane` passes `catalogProvider ?? ''` for a
 * self-hosted endpoint the catalog has never heard of, and an empty string has
 * no initial to take.
 */
function monogramFor(provider: string): string | null {
  for (const character of provider) {
    if (/[a-z0-9]/i.test(character)) return character.toUpperCase()
  }
  return null
}

/**
 * The mark for a vendor that has neither a logo nor a name to take a letter
 * from: an empty tile, which is exactly what is known about it.
 *
 * The one drawn figure left in this file, and it is not standing in for a
 * brand — it is the absence of one. Stroked on the same 24-unit grid as the
 * brand paths so it sits at their optical weight.
 */
const UNNAMED = (
  <rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
)

/**
 * A vendor name to the mark that stands for it.
 *
 * The prop is a `string` rather than `ProviderId` because the value that
 * arrives here for a harness connection is `catalogProvider` — the vendor a
 * connection draws its models from — and that field is open by contract: it
 * is whatever the built-in catalog calls the vendor, or absent entirely for a
 * self-hosted endpoint the catalog has never heard of. A closed union could
 * not name "together-ai" or "a box in the next room", so the component would
 * have had to be lied to at every call site.
 *
 * Note what must NOT be passed: a connection's `id`. That is the user's own
 * name for one account — "work-openai", "spare-key" — and the harness keeps
 * it deliberately separate from the vendor for exactly this reason.
 *
 * Anything unrecognised, including the empty string, resolves to `custom`.
 * A missing drawing is not an error worth a crash on a settings page.
 */
function markFor(provider: string): ProviderId {
  for (const id of PROVIDER_IDS) if (id === provider) return id
  return 'custom'
}

/**
 * The real logo for one vendor id, or null while unknown.
 *
 * The drawn marks are the floor and render immediately; this upgrades to the
 * vendor's real logo when the harness has one (models.dev, cached on disk).
 * Null is cached as firmly as a success - most of the two hundred OpenRouter
 * authors have no logo anywhere, and a picker must not re-ask for them on
 * every render.
 */
function useProviderIconDataUri(provider: string): string | null {
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    if (provider === '') return undefined
    let live = true
    void resolveProviderIcon(provider).then((resolved) => {
      if (live && resolved !== null) setUri(resolved)
    })
    return () => {
      live = false
    }
  }, [provider])

  return uri
}

export function ProviderMark({
  provider,
  size = 'text',
  className,
}: {
  /** A vendor name — `catalogProvider`, or a catalog row's id. Not a connection id. */
  provider: string
  size?: IconSize
  className?: string
}) {
  // Sized from its text like every other mark, so a provider badge beside a
  // model name matches that name rather than a step chosen at the call site.
  const box = size === 'text' ? '1.1em' : ICON_STEP[size]
  const id = markFor(provider)
  const brand = BRAND[id]
  const realIcon = useProviderIconDataUri(provider)

  // The real logo, when one resolved, replaces the drawn mark outright - and
  // keeps the same `data-provider` resolution, so nothing observing which
  // vendor a row names can tell the difference between the two sources. It is
  // a mask rather than an image because the source SVGs are monochrome
  // `currentColor`; the background is what paints through it, and it is
  // `currentColor` for every vendor without exception.
  if (realIcon !== null) {
    return (
      <span
        aria-hidden
        draggable={false}
        data-mark="logo"
        style={{
          width: box,
          height: box,
          backgroundColor: 'currentColor',
          maskImage: `url("${realIcon}")`,
          WebkitMaskImage: `url("${realIcon}")`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
        data-provider={id}
        className={cn('studio-icon shrink-0', className)}
      />
    )
  }

  // No importable brand path: the vendor's initial, in the interface face at
  // the mark's own size. A span rather than SVG `<text>`, which measures
  // against whatever font happens to have loaded and is a well-known way to
  // ship a glyph that jumps on first paint.
  if (brand === null) {
    const letter = monogramFor(provider)
    if (letter !== null) {
      return (
        <span
          aria-hidden
          data-provider={id}
          data-mark="monogram"
          className={cn('studio-icon inline-flex shrink-0 items-center justify-center', className)}
          style={{
            width: box,
            height: box,
            // Sized from the mark's box rather than the surrounding text, so a
            // monogram and a logo beside it are the same height. Inter's cap
            // height is a shade over 0.7em, which puts the letter at about the
            // fill of a brand path in the same square.
            fontSize: box,
            lineHeight: 1,
            fontWeight: 500,
            // Ids are lower-case and letters are not evenly weighted; a little
            // negative tracking stops a wide cap sitting off its own centre.
            letterSpacing: '-0.02em',
            userSelect: 'none',
          }}
        >
          {letter}
        </span>
      )
    }
  }

  return (
    <svg
      style={{ width: box, height: box }}
      viewBox="0 0 24 24"
      aria-hidden
      // The mark is decorative, so it carries no accessible name and the row
      // beside it does the naming. This says which drawing was resolved, which
      // is the one thing an inspector or a test cannot otherwise recover from
      // a path element. `data-mark` says which of the three sources answered,
      // which used to be inferable from the element name and is not any more:
      // a logo and a monogram are both spans.
      data-provider={id}
      data-mark={brand === null ? 'unnamed' : 'brand'}
      shapeRendering="geometricPrecision"
      className={cn('studio-icon shrink-0', className)}
    >
      {brand === null ? (
        UNNAMED
      ) : (
        // The brand paths are solid shapes, so they fill rather than stroke —
        // and they must not inherit the `non-scaling-stroke` treatment meant for
        // outlined marks, which is why `stroke` is explicitly none.
        <path d={brand} fill="currentColor" stroke="none" />
      )}
    </svg>
  )
}
