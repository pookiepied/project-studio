# 0043 — Simple sans plus editorial display

**Status:** Accepted
**Date:** 2026-08-16

## Context

ADR 0042 removed Instrument Serif and made Newsreader the single serif for both
reading and display. In practice the two registers did not resolve into one
voice: everyday content (chat transcripts, note bodies) is product content and
reads better in the same simple sans as the rest of the UI, while display
moments (page titles, dialog headers, the note title) benefit from the
editorial contrast of a display serif.

The system should be one simple, everyday font plus one editorial font, each
with one job — not two serifs and not a serif used for daily reading.

## Options

1. **Keep ADR 0042 (Newsreader for everything).** One serif, but daily product
   content sets in a serif, which is neither simple nor everyday-friendly.
2. **Inter + Instrument Serif.** The simple sans carries all everyday content
   and chrome; the editorial serif is reserved for short display moments. Each
   font has one unmistakable job.

## Decision

**Inter Variable plus Instrument Serif.** Two fonts, two jobs:

| Token | Face | Job |
|---|---|---|
| `--font-sans` | Inter Variable | Everything everyday: UI chrome, body, chat transcripts, note bodies |
| `--font-display` | Instrument Serif | Editorial display only: page titles, dialog headers, the note title |

Enforced globally in `STUDIO/src/index.css`:

- `.studio-prose` sets in the simple sans (`--font-sans`) — the conversation is
  product content, so it reads in the same face as the rest of the UI.
- `.studio-display` sets in the editorial serif (`--font-display`) — short
  display moments only.

Mono (`ui-monospace` stack) is a system stack for code and IDs, not a brand
face.

## Consequences

**Easy:** everyday content is calm, legible, and consistent with the UI. The
editorial serif appears exactly where it earns its contrast — short display
moments — and nowhere else, so it stays a statement rather than wallpaper.

**Hard:** display titles are a distinct register from body text by design; that
is the editorial identity, not an inconsistency. Newsreader is gone; the brand
has no long-form serif reading face, and that is deliberate — the product does
not ship long-form serif reading.

**Foreclosed:** using the editorial serif for body or paragraph text, and
reintroducing a third brand font.
