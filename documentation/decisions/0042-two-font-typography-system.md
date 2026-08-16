# 0042 — Two-font typography system

**Status:** Superseded by 0043
**Date:** 2026-08-16

## Context

STUDIO's frontend loaded three font families: Inter Variable (UI), Newsreader
Variable (editorial), and Instrument Serif (display). The third family existed
for short display moments — page titles, dialog headers, the note title — but
those moments were few and the voice it added was a second, competing serif
rather than a distinct register.

The goal is a minimal, editorial brand identity: few fonts, each with one
unmistakable job, enforced globally so no page makes its own font decision.

## Options

1. **Keep three fonts.** Inter for chrome, Newsreader for reading, Instrument
   for display. More art direction at title sizes, but every title becomes a
   serif-vs-display decision, which fights the minimalism goal.
2. **Drop to two fonts.** Inter for all UI chrome, Newsreader for all content —
   titles included, differentiated by weight and tracking rather than family.
   Simpler, one serif voice, and it makes the editorial identity coherent.

## Decision

**Two fonts.** Remove Instrument Serif. Newsreader is the single serif voice,
serving both the reading register (`.studio-prose`) and the display register
(`.studio-display`), the latter via semibold weight and tight tracking.

The editorial family is intact and now carries the entire brand's serif
personality. The difference between a title and a paragraph is weight,
tracking, and size — not a font swap.

The typography contract, enforced globally in `STUDIO/src/index.css`:

| Token | Face | Job |
|---|---|---|
| `--font-sans` | Inter Variable | All UI chrome: chrome, buttons, labels, lists, inputs |
| `--font-editorial` | Newsreader Variable | All content: prose (`.studio-prose`), display titles (`.studio-display`) |

Mono (`ui-monospace` stack) is a system stack for code and IDs, not a brand
face, and costs nothing to load.

## Consequences

**Easy:** every text role has exactly one font. A title and a paragraph share
DNA, so the brand reads as one voice. The global class and tokens mean a new
page inherits the system without importing a font.

**Hard:** display moments are quieter than Instrument Serif's high-contrast
masthead look. That is the trade accepted: product UI prefers the consistent
editorial voice; the moment a title needs more presence, weight and tracking
are tuned — not a third font added.

**Foreclosed:** a second serif for decorative display. If it ever returns, it
must be justified against this ADR.
