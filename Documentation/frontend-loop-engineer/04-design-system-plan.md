# Frontend Loop Engineer - Design System Plan

Status: First-pass plan recorded on 2026-07-10.

## What Exists

The app already has a practical design-system base:

- `src/design/tokens.css`
- `src/design/typography.css`
- `src/design/fonts.ts`
- `tailwind.config.js`
- `src/ui/primitives/*`
- `src/ui/feedback/*`
- `src/ui/layout/*`
- `src/ui/brand/*`
- `src/ui/icons/*`

The token model is semantic and mostly neutral: surface, text, focus, marker,
shadow, scrollbar, and syntax tokens bridge into Tailwind.

## Problems Found

- `npm run lint` fails because raw `<button>` remains across the app.
- The lint rule catches the primitive implementations themselves
  (`Button.tsx`, `IconButton.tsx`, `SegmentedControl.tsx`, `Toggle.tsx`, etc.),
  so the rule needs a better carve-out or file-level override before it can be
  used as a clean quality gate.
- Hardcoded colors remain in:
  - brand/app icons and third-party marks
  - Terminal/xterm themes
  - Mermaid theme variables
  - Recharts/chart colors
  - React force graph colors
  - Claude accent treatments
  - extension app cards
  - workspace app launcher colors
- `src/index.css` still owns global base, prose, markdown, and syntax styling in
  one file.

## Carve-Out Policy

Raw colors are acceptable only when required by:

- third-party brand identity
- canvas/WebGL/chart libraries that require literal values
- syntax rendering library contracts
- terminal palette compatibility
- explicitly documented product accent exception

All other visual styling should use semantic tokens or primitives.

## First Design Loop

1. Update ESLint guardrail so design primitives can legally implement native
   controls.
2. Convert app-shell pages and global feedback controls from raw buttons to
   `Button`/`IconButton`.
3. Add a small carve-out registry or comments for approved raw hex use.
4. Split `index.css` gradually only if it reduces real maintenance pain:
   `base.css`, `scrollbars.css`, `prose.css`, `syntax.css`.

## Validation

`npm run lint` should move from a baseline failure to a shrinking actionable
list. `npm run build` must stay passing.
