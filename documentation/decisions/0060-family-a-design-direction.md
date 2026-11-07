# 0060 — Family A Design Direction

**Status:** Accepted
**Date:** 2026-11-07

## Context

Studio's graphite design was sound in its parts but did not feel finished, and
adjusting it piece by piece had no end point. The owner compared it with eight
references and chose Family A, the compact composer-and-panel software in
references 1 to 5, as a deliberate bet on a whole identity.

## Decision

Studio follows Family A's appearance, proportions and layout as closely as it
can, while keeping its existing features and logic. Phase 1 covers the window,
composer, top navigation and interactions, one at a time.

- The window opens at a 720x845 panel with a 40px corner and 15px body text,
  which is the reference at a scale of 0.907.
- The accent is `#3AA8FE`, the colour sampled from the reference. This ends the
  monochrome chrome rule.
- Inter is the only interface face. The clover stays.
- Window controls follow the reference: maximize and close, with no minimize.
- Work is inline first, and anything that cannot fit opens as an overlay sheet.

Windows cannot round a window to 40px or shadow a transparent one, so the OS
window is larger than the panel. The panel is inset 28px and draws its own
corner and shadow in CSS, with DWM rounding off.

## Options considered

- **Keep the OS window at the panel's size.** No margin, but no soft shadow.
  This was the fallback if the inset failed in practice.
- **Inset the panel.** Chosen, because the reference's soft edge needs it.

## Consequences

- The transparent margin belongs to Studio, so it blocks clicks to whatever is
  behind it, in a 28px band around the panel.
- Resizing happens on an 8px band outside the panel, which the app runs itself
  and which follows the corner's curve.
- Saved window sizes are kept, so existing installs stay at their old size until
  "Reset to default size". Saved text sizes are kept in the same way.
- Without a minimize button, the taskbar icon and Win+Down are the only ways to
  minimize.
