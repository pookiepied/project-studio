import { useEffect, useState } from 'react'
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
 * One question, asked once: the harness's icon catalog. Which upstream
 * actually had the mark is deliberately not this file's business — see
 * `providers/icons` in the harness, where two sources sit behind one lookup
 * and a disk cache.
 *
 * Bundling marks here was tried and removed. Five brand paths from Simple
 * Icons sat as an offline floor beneath the harness, and the floor turned out
 * to be one nobody stands on: every surface that draws a provider mark is a
 * model picker or the Providers pane, and both render "no harness is
 * connected" when the harness is not running. Nothing was being caught, and
 * the bundle was a strictly smaller copy of a set we already had.
 *
 * So the harness answers or nobody does, and what that reaches is measured
 * rather than assumed. Against the live catalogs: 193 of models.dev's 207
 * providers, and 36 of the 51 model authors OpenRouter actually serves. The
 * remaining fifteen are individuals publishing fine-tunes — `sao10k`,
 * `thedrummer`, `gryphe` — for whom no logo exists anywhere to fetch.
 *
 * Those SVGs are monochrome `currentColor` by design — drop one into an
 * `<img>` and it renders black everywhere, ignoring the theme. So the logo is
 * not an image here: it becomes a CSS mask on a span and the span's
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
 * Who actually falls through to a letter is worth being precise about, because
 * it is a much smaller set than it looks. Measured against OpenRouter's live
 * list, 36 of 51 authors resolve to a real mark. The fifteen that do not are
 * `sao10k`, `thedrummer`, `gryphe`, `undi95`, `mancer`, `anthracite-org` and
 * their neighbours: individuals publishing fine-tunes, not companies. Writer
 * and Reka are the only firms among them.
 *
 * That is the honest shape of the remainder — vendors for whom no logo exists
 * anywhere, rather than vendors we failed to look up. A self-hosted endpoint
 * is the same case by definition and always will be.
 *
 * Drawing a mark ourselves for that remainder is not on the table, for the
 * reason it never was: an invented figure in a row of real logos reads as a
 * missing asset, and reproducing a trademark is the kind of thing that has to
 * be undone later, publicly.
 */

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
 * The one drawn figure in this file, and it is not standing in for a brand —
 * it is the absence of one. Stroked on a 24-unit grid so it sits at the
 * optical weight of the logos it appears beside.
 */
const UNNAMED = (
  <rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
)

/**
 * The real logo for one vendor id, or null while unknown.
 *
 * The monogram renders immediately and this upgrades to the vendor's real
 * logo when the harness has one (models.dev, cached on disk). Null is cached
 * as firmly as a success - a community fine-tuner has no logo anywhere, and a
 * picker must not re-ask for them on every render.
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
  // `text` is the ordinary case and it is deliberately NOT text-sized: see the
  // note on `--provider-mark` in `styles/type.css` for why a brand logo cannot be
  // sized like a Lucide glyph. The named steps stay available for the two
  // places that want a larger mark, and the tile keeps its ratio to whichever
  // step was asked for so the slot never changes shape.
  const mark = size === 'text' ? 'var(--provider-mark)' : ICON_STEP[size]
  const tile = size === 'text' ? 'var(--provider-tile)' : `calc(${ICON_STEP[size]} * 1.32)`
  const realIcon = useProviderIconDataUri(provider)

  // `data-provider` is the vendor string exactly as it arrived. It used to be
  // the result of bucketing that string into a seven-value union, which threw
  // away the answer at the moment it became interesting: a `qwen` row and a
  // self-hosted box both reported `custom`, so neither an inspector nor a test
  // could tell which vendor a mark was actually naming. `data-mark` says which
  // source answered, which is not otherwise recoverable now that a logo and a
  // monogram are both spans.
  //
  // Both live on the mark rather than on the tile, because the mark is the
  // thing that varies and the tile is the thing that does not.
  const inner =
    realIcon !== null ? (
      // The real logo. A mask rather than an image because the source SVGs are
      // monochrome `currentColor`; the background is what paints through it,
      // and it is `currentColor` for every vendor without exception.
      <span
        aria-hidden
        draggable={false}
        data-provider={provider}
        data-mark="logo"
        className="studio-icon shrink-0"
        style={{
          width: mark,
          height: mark,
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
      />
    ) : (
      <Fallback provider={provider} mark={mark} />
    )

  // The tile. It is what makes a column of vendors read as one list: a dense
  // logo, a simple one and a letter all occupy the same slot at the same size,
  // so the eye tracks a single edge down the column instead of a ragged one.
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-tint',
        className,
      )}
      style={{ width: tile, height: tile }}
    >
      {inner}
    </span>
  )
}

/** A vendor with no logo: its initial, or an empty tile when it has no name. */
function Fallback({ provider, mark }: { provider: string; mark: string }) {
  // A span rather than SVG `<text>`, which measures against whatever font
  // happens to have loaded and is a well-known way to ship a glyph that jumps
  // on first paint.
  const letter = monogramFor(provider)
  if (letter !== null) {
    return (
      <span
        data-provider={provider}
        data-mark="monogram"
        className="studio-icon inline-flex shrink-0 items-center justify-center"
        style={{
          width: mark,
          height: mark,
          // Sized from the mark's box rather than the surrounding text, so a
          // monogram and a logo beside it are the same height. Inter's cap
          // height is a shade over 0.7em, which puts the letter at about the
          // fill of a brand path in the same square.
          fontSize: mark,
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

  // Neither a logo nor a name to take a letter from.
  return (
    <svg
      style={{ width: mark, height: mark }}
      viewBox="0 0 24 24"
      data-provider={provider}
      data-mark="unnamed"
      shapeRendering="geometricPrecision"
      className="studio-icon shrink-0"
    >
      {UNNAMED}
    </svg>
  )
}
