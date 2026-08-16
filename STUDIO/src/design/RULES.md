# The rules

What Studio decides once, so no component decides it again.

This file is the reasoning. The values live in `tokens/` and in `index.css`;
if the two ever disagree, this file is what they were both trying to say.

Studio is a calm app for a person having a conversation. It is not a developer
tool, and almost every rule below is downstream of that one sentence.

---

## 1. Interaction

**One state, one channel.** A control has four states — rest, hover, press,
active — and each is carried by exactly one thing. Two channels escalating at
once is what made a hovered icon the highest-contrast pixel on screen.

| State | What moves | What must not |
|---|---|---|
| rest | nothing | — |
| hover | the chip appears (`--tint`) | the glyph must not darken, thicken, or move |
| press | the chip deepens | the button must not scale |
| active | the chip stays (`--selected`) | the glyph must not darken |

**A mark is always `--muted-foreground`.** In every state, in every row, on
every surface. `.studio-icon` enforces it; nothing inherits `currentColor` from
the text beside it. Two deliberate exceptions, both opting in via the utilities
layer: a mark on a filled chip (unreadable otherwise) and a destructive menu
row (the glyph is the warning).

**The button does not move.** A control that scales under the cursor is a touch
affordance. Under a desktop pointer it reads as the layout being unstable.

**The reactive area is the control, not the glyph.** Hover and press are
published by the button through `IconStateContext`, so a 28px target drives the
14px mark inside it — not a small live patch in the middle of a dead square.

**Motion is what pays for the missing contrast.** Because nothing darkens,
something has to answer the pointer. A mark moves for exactly two reasons:

- **State** — the chevron turns, the plus becomes a cross, the sidebar's
  divider slides to where the panel edge now is.
- **Action, previewed** — send lifts the way the message will, the trash lid
  tilts, retry begins the rotation it will finish.

Nothing moves to be charming.

---

## 2. Motion

Three durations and three springs. Every animation picks from them.

- **Things you moved** use a spring. The physics is the feedback.
- **Things that appear or vanish** use a duration and an ease-out. There is no
  object to model, so a spring is only latency.
- **Nothing exceeds ~300ms.** Past that a transition reads as a wait.

`--duration-fast` (120ms) hover and chips · `--duration-base` (180ms) entering
and leaving · `--duration-slow` (260ms) a whole surface.

The CSS variables and `tokens/motion.ts` hold the same three numbers on
purpose: a CSS transition and a Framer animation on the same element must not
disagree. They did — fourteen files had reached for `duration-150`, which was
not a step in either system.

The splash is the one exception to the ceiling. It is not interaction: it plays
once, before anything can be clicked.

Reduced motion is handled twice, globally, and never in a component:
`<MotionConfig reducedMotion="user">` and the media query in `index.css`.

---

## 3. Shape

Radius descends from the window. The window is 20; everything else agrees with
it or looks pasted on.

**The concentric rule:** a container of radius R with padding P holds children
of radius R − P. Break it and the inner arc bulges past the outer one.

Softer than is typical, deliberately — at this size the difference between
"corners taken off a rectangle" and "a soft object" is the difference between
an interface that feels calm and one that feels administrative.

**Icon-only controls are circles, always.** There is no second answer and no
`round` prop. Four corners at 28px are four things asking to be noticed; the
chip is the whole state signal now, and a circle is the shape that reads as a
resting place for a mark rather than a button drawn around one.

---

## 4. Elevation

Five steps, because five things are lifted and each is lifted a different
amount: `chip` → `raised` → `lifted` → `overlay` → `modal`, plus `panel` for
the compact sidebar casting sideways.

Every shadow in the app comes from this scale. Before it, eight files each
hand-wrote a blur, spread and opacity, so a popover and a menu — the same idea
one level apart — cast unrelated shadows.

**Dark mode is part of the scale, not a per-component override.** A shadow
tuned for white is invisible against a 0.205 surface, and the hairline inverts:
what separates a raised object from a dark background is a faint *light* edge.
Components must never write `dark:shadow-[...]`; the one that did had no state
condition on it and silently disabled the composer's focus lift in dark mode.

---

## 5. Colour

Monochrome, with no exception. Every value is oklch with chroma 0 — including
the window controls, where the macOS red/amber/green would be the only
saturated pixels in the app and therefore the first thing the eye lands on
every time it opens. Position and order carry that meaning; the colour was
decoration.

Hover and selection are **translucent tints of the foreground**, not opaque
swatches. A tint composites, so the same two values work on the sidebar, inside
a popover, and over a raised card, each staying a shade of what is already
there. An opaque grey reads as a separate object dropped behind the text.

---

## 6. Type

Two families. Inter for everything read; Instrument Serif for the one statement
a page makes — a greeting, a page title. Anywhere else the serif stops being a
voice and becomes a second UI font.

**Roles, never sizes.** Components name `text-body`, `text-ui`, `text-caption`,
`text-micro`, `text-title`. Nothing writes `text-sm`. Every role derives from
`--ui-size`, so the whole app scales from one number.

**Overridable, never overridden.** Roles live in `@layer components`, so a
deliberate utility at a call site still wins. That is the balance the system is
aiming at: default everywhere, locked nowhere.

Two things this cost us, both worth knowing:

- `tailwind-merge` does not know the custom roles, so it silently deleted them
  as conflicting `font-size` classes. `cn.ts` teaches it the group. This is why
  fonts "wouldn't apply" across three separate attempts.
- Unlayered CSS beats *all* layered CSS regardless of specificity. KaTeX ships
  unlayered, so the math cap had to move out of `@layer components` to work.

**Icons size from their text** (`1.1em`), so a mark in a caption is caption-
sized and the same mark in a heading grows. The absolute steps are px, never
rem — the root font-size is the user's UI size here, so every `rem` utility
silently paints at 0.81×.

---

## 7. Icons

**One mark, one concept.** Enforced at startup in development. Once a shape
means two things, neither reading is safe.

Permission modes are a **transport control** — pause, write, run on — not
shields. A shield says the app is a hazard being contained, which is the
developer-tool reading and the wrong one: choosing "manual" is not raising a
guard, it is asking to be consulted.

Project marks are **abstract, not pictorial**. A flask says the project is an
experiment; the user picking a mark to tell two projects apart should not end
up making a claim about the work. They differ by silhouette, not subject.

Two renderers, and the seam is invisible by design. `fromLucide` wraps a
finished library component and animates it as a whole — that is every mark in
the app but one. `defineIcon` draws the glyph here, and exists only for marks
whose meaning lives in a part that moves independently. Today that is the
sidebar toggle. Both accept `size` and `state`; a call site cannot tell which
it is holding.

---

## 8. Shell

The window is frameless and transparent; a rounded panel inside paints the
visible surface. The 20px corner is a **DWM attribute set in Rust**, not CSS —
CSS cannot round the OS window, and looking at the DOM will not tell you
whether it is working.

The top strip is transparent: no fill, no hairline. Content scrolls under it
and is masked by a gradient rather than hidden behind a bar. The band directly
under the traffic lights is solid so the title never collides with text sliding
past; only below that does it fade.

Drag uses `startDragging()`, not `data-tauri-drag-region`. The attribute also
binds double-click-to-maximize, and Windows squares a maximized window — so a
drag region on the brand band silently cost us the rounded corner.

Below 900px the sidebar stops being part of the layout and floats over it. The
page always keeps the whole window; the sidebar is summoned rather than
resident. The same switch covers touch and mobile, so there is no second,
disagreeing rule for small screens.

---

## 9. How to add something

1. Use a role, a token, a scale step. If none fits, the missing step is the
   change — add it here first.
2. Never style a mark at a call site. Change the concept.
3. Never write a duration, a shadow, or a font size as a literal.
4. If a rule has to be broken, opt out in the utilities layer and say why in a
   comment. Two places do this today and both name their reason.
