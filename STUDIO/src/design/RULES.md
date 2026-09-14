# The rules

What Studio decides once, so no component decides it again.

This file is the reasoning. The values live in `tokens/` and in `styles/`;
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

**Focus is answered by register, not by one treatment.** A control answers
with an edge — its border deepens, and that is all. A bloom behind the edge
was tried at two weights and the person using the forms read both as a thick,
old-fashioned grey outline; monochrome cannot borrow hue to say "focus rather
than warning", so a second grey on the same edge says thickness instead of
attention. A surface answers with elevation: the composer lifts one step of the
shadow scale and draws nothing. The keyboard outline is the third and loudest
register (`--ring`, 45%) and is keyboard-only — `:focus-visible` is what makes
an assertive ring polite. One token never serves two registers; when the
fields consumed `--ring` they inherited the outline's 45% and every click read
as an error state.

**A mark is always `--muted-foreground`.** In every state, in every row, on
every surface. `.studio-icon` enforces it; nothing inherits `currentColor` from
the text beside it. Two deliberate exceptions, both opting in via the utilities
layer: a mark on a filled chip (unreadable otherwise) and a destructive menu
row (the glyph is the warning).

**A menu note names a consequence, never the verb.** A `note` on a `MenuItem`
adds a second line, so an item that carries one is twice the height of the
items around it. That weight is worth spending on something the reader cannot
see and would be wrong about -- what happens to their data, and whether it can
be undone: "Keeps the folder on disk. Conversations stay.", "Kept
indefinitely. Settings has the archive." It is not worth spending to define
the label. Fork carried "A new conversation carrying everything said here.",
which is a longer way of saying Fork, and it made the one item in a six-item
menu that needed no explanation the tallest thing in it. If the note would
still be true with the verb removed from it, it is a definition, and the label
should carry its own meaning instead.

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

**A handover between surfaces moves along the hierarchy, not the vertical.**
Home sits under nothing, a project under home, a conversation under its
project, and Settings is the deepest layer. So navigation is a *move* — push
(drilling in), pop (coming back), or sibling (lateral, one conversation for
another) — and the surfaces say which way:

- **push**: the new surface enters from the right (32px out) while the old
  leaves to the left (24px out), on `--duration-slow`.
- **pop**: the mirror image. Back must look like back, or direction stops
  meaning anything.
- **sibling**: a pure crossfade on `--duration-base`, no translation. The
  sidebar's sliding selection chip carries the sense of travel.

Distances are a fraction of a column, not a journey. Vertical motion on a
horizontal handover is the one gesture that reliably reads as a rendering
fault — nothing in the app's hierarchy is stacked vertically — and a page
must never play the shell's entrance a second time inside itself: two stacked
ramps compound into a hop. The shell owns the page-level handover; a page
animates only the changes it owns, and a crossfade at that. One exception,
for the same reason: a surface that owns a hierarchy the shell never plays —
the model library's family → model drill-down — uses the same push / pop /
sibling vocabulary for its own pages, because nothing is moving underneath
it and direction is the only thing saying "deeper".

**A direction-aware exit must receive the move through `custom`.**
AnimatePresence freezes an exiting element's props at its last render, so a
spread `exit` replays the PREVIOUS move — back out of a drill-in and the old
surface leaves to the wrong side while the new one enters from the right.
The variants in `tokens/motion.ts` (`surfaceVariants`) re-read the move as
each pose plays; use them wherever a handover can change direction.

The splash is one exception to the ceiling. It is not interaction: it plays
once, before anything can be clicked. The other is the ambient loops, the app
saying "still working" while nobody does anything - they are a state made
visible, not a transition. They pick from `LOOP` in `tokens/motion.ts`: `spin`
(a ring turning, linear), `pulse` (a body breathing in place), `sweep` (a
highlight travelling across something). A staggered set spreads its delays
from the loop's own duration, never from a second number.

Reduced motion is handled twice, globally, and never in a component:
`<MotionConfig reducedMotion="user">` and the media query in `styles/base.css`.

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
`--ui-size`, so the whole text system scales from one number.

**The root font-size is 16px, and text size never touches it.** The root is the
rem grid the layout is drawn on — control heights, paddings, dialog widths.
Setting it to the UI text size once put every rem utility at 0.81× of the
geometry it was authored as while the px-based marks, radii and tokens painted
full size, so the whole app was a negotiation between two unit systems
disagreeing by 23%, and every size preference rescaled the layout without
moving the marks. Text sizes are px variables applied by the roles; the default
size sits on `body` so un-roled text inherits it exactly as before.

**Control geometry derives from `--ui-size` too.** `--control-sm/md/lg` are
multiples of the interface text (2, 2.33, 2.67), and `IconButton` reads them
instead of `size-6/7/8`. This is the other half of the rule above, and for a
long time it was missing: text scaled from one number and every box was a fixed
px or rem constant calibrated when the text was 14. At 12 the boxes kept the
proportions of the larger scale, and a size preference moved the text while the
sidebar, the chrome and the composer stood still — which is exactly what
"changing the font size does nothing" was. Nothing that holds text may state its
height as a rem utility or a literal; it names a control step.

**A container's height is an outcome, not a constant.** The composer was 52px
because it held 32px controls with 10px of padding, and the text inside had no
say at all — 11px text in a 52px box, 4.7× where every other control in the app
was 2.2–2.4×. Setting the font to anything at all left the field exactly 52
tall, which is why no amount of type tuning ever fixed it. `COMPOSER` now
computes its height and its radius from the control step and the padding.

**Overridable, never overridden.** Roles live in `@layer components`, so a
deliberate utility at a call site still wins. That is the balance the system is
aiming at: default everywhere, locked nowhere — and it is also the sharpest
edge in the system, because "still wins" includes winning by accident.

**One size, one leading.** A role carries size *and* leading, and a `leading-*`
utility beside a role class sits in the utilities layer and silently outranks
it. Eleven call sites did this, and the result was 11px rendering at three
different leadings and 12px at two — identical pixels at a different rhythm,
which reads as a size difference nobody can locate in the code because no size
was ever changed. Leading belongs to the role. If a control needs its glyph
optically centred, centre it with flex, not by flattening the line box.

Two things this cost us, both worth knowing:

- `tailwind-merge` does not know the custom roles, so it silently deleted them
  as conflicting `font-size` classes. `cn.ts` teaches it the group. This is why
  fonts "wouldn't apply" across three separate attempts.
- Unlayered CSS beats *all* layered CSS regardless of specificity. KaTeX ships
  unlayered, so the math cap had to move out of `@layer components` to work.

**A mark centres on a line, never on a margin.** For a single-line row that is
`items-center` and nothing else. For a mark that must sit on the *first* line of
a multi-line block, the wrapper is `flex h-[1lh] items-center` and the row stays
`items-start` — the box is exactly one line tall, so the glyph centres inside
the line it belongs to. Never `mt-px` or `mt-0.5`. Those are measured by eye
against one specific line-height, and they are silently wrong the moment that
leading changes: `MenuItem`'s `mt-px` was tuned against `leading-tight`, and
when the label took its role's real leading the nudge left every icon in every
menu 1.26px above the text's cap height. Put `text-ui` (or whichever role owns
that line) on the wrapper too — `1lh` resolves against the element's *own*
line-height, so an unqualified wrapper measures whatever it happened to inherit,
and a `text-micro` hint measures its own 14.5px line rather than the 18.6px line
it is aligning to.

**Cap height is the reference, not the ink box.** Descenders drag a text run's
ink centre down by a pixel or more, so "centre the icon on the text" measured
against full ink extents produces a mark that sits visibly low. Align to the
midpoint between baseline and cap height; `items-center` on a line box already
does this, which is why the correct rows measure 0.00 against it.

**Icons size from their text** (`1.1em`), so a mark in a caption is caption-
sized and the same mark in a heading grows. The absolute steps for standalone
marks are CSS variables (`--icon-*`) derived from `--ui-size`, so a mark in a
round control tracks the size preference exactly as a mark beside a label
does — the two stopped agreeing the moment the steps were fixed px and the
text was not.

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

## 9. The content hierarchy

A reply is not one kind of surface. It is prose with objects in it, and the
objects are not all the same kind of object. There are three treatments, and
which one a piece of content gets is decided by what the content *is* — never
component by component.

**Independent.** An image or a video is the message. It renders as itself, at
its own measure, with its own viewer. (`MediaArtifact`.)

**Embedded.** Content the model fetched or assembled from elsewhere — a search,
a mailbox, a repository, a calendar, and a table — sits on one sunken ground:
`rounded-xl bg-surface-sunken`, no border, no shadow, no caption bar, content
directly on the surface. It reads as part of the reply that is *about*
something, not as a second document stacked on the first. Inside an artifact
the shell already provides the ground, so the content sits on it bare; in bare
markdown a table brings the same ground with it. (`ArtifactShell`, the table
rules in `Markdown` and `Sections`.)

**Preview.** Content the reader takes away rather than reads in place — code, a
draft, a rewrite — gets a dedicated preview container: its own surface, a
caption, a copy control, and a cap. Past the cap it fades. There is no inner
scroller and no "show all": the full text is one copy away, and the reply keeps
moving. (`BlockFrame`.)

Everything else is prose and stays inline. Long prose is clamped behind the
same fade where it stands (`CollapsibleText`) — never re-housed in a container,
because a long paragraph is not a different kind of paragraph.

The differences between the three are intentional and they are the only ones: a
thing you watch (independent), a thing you read about (embedded), a thing you
take (preview). When a new kind of content arrives, it joins a tier. It does not
get a fourth look.

---

## 10. States

A surface has a life before its data arrives and after it fails to. Every
state in that life is designed, once, in `components/state`; a page that
invents its own loading treatment is a page inventing a second vocabulary.

**The lifecycle is named, not boolean.** `loading | ready | no-harness |
failed` — the same four answers a local process honestly gives. A surface
shows its truth: `loading` is the one wait, `failed` says
what went wrong with the remedy beside it, `no-harness` says what is absent,
and `ready` may say *empty* — an absence naming itself ("Nothing archived."),
never styled like a failure. A read that has not come back may not be
answered with "nothing", because an empty list and a broken one are both a
blank column to the person waiting.

**Loading draws nothing, except in the conversation.** A list, a pane or
a column that is still being read shows its frame and no rows, announces
itself (`Loading`, a status region and nothing visible), and the rows
arrive - a read to this machine usually lands in a few frames, and anything
drawn for those frames says "loading" about something already loaded. The
conversation is the one surface with a drawn wait (`TranscriptWait`: three
dots bobbing in turn, `BobbingDots`, faded in only once the wait has lasted
150ms), because a history can be long and an empty page that says nothing
looks stopped. The breathing dots (`WorkingDots`) stay beside a label -
"Searching…" - where a line is already saying what runs; the ring
(`WorkingRing`) is the composer's halo round the stop control and nothing
else. Rules:

- Never a skeleton. Bars shaped like the content to come held its space
  well, and were refused (2026-09-14) for what they are: a picture of content
  nobody has seen. The placeholder primitives are gone; do not rebuild them.
- Never the brand mark. It is the app's face, not its hourglass.
- The wait reports activity, never progress. A bar that fills is inventing
  a fraction of a duration nobody measured.
- A surface that opens at its end - the transcript - is landed on unseen
  and revealed where it stands. No journey from the top is drawn.
- Something *true* may stand in instead: the plain code a highlighter will
  colour, the poster a player will play. Content is not a stand-in.
- Announced once, quietly: `role="status"` with a spoken label on the region,
  anything drawn `aria-hidden`.
- A background re-read never replaces content with loading. What is on screen
  stays until the new truth arrives; the refresh is visible in the rows that
  change, not in a wait that erases the page.

**Failure repeats the wire, verbatim.** The cause sentence is the harness's
own words, not a paraphrase, and the remedy is a control, not advice —
"Start the harness" is a button, because a sentence naming a remedy the
software does not offer is worse than no sentence. `StateNote` is the shape;
an empty state is not `StateNote`, on purpose.

---

## 11. How to add something

1. Use a role, a token, a scale step. If none fits, the missing step is the
   change — add it here first.
2. Never style a mark at a call site. Change the concept.
3. Never write a duration, a shadow, or a font size as a literal.
4. If a rule has to be broken, opt out in the utilities layer and say why in a
   comment. Two places do this today and both name their reason.
