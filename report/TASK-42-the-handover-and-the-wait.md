# TASK 42 — The handover and the wait

Brief: two systems the app had been living without. First, a global
loading-state and content-placeholder system — skeletons that represent the
actual UI, one shared animation, named empty and error states, applied
everywhere data arrives, instead of blank columns and one-line prose where
each pane happened to remember to write some. Second, a page-transition
system: navigation between surfaces had two visible faults — entering Settings
played a compound upward hop that read as a rendering bug, and switching
conversations was an entrance-only 6px rise with no exit, which reads as "too
basic". The task was to diagnose the faults, then build one motion language
for every handover rather than tuning the old animation.

Everything below was driven against the production build (`pnpm build`,
served with `vite preview`). Verification: `pnpm typecheck` clean; the vitest
suite at **401 passed / 41 files, zero failures** (seventeen new tests written
for this task); the transition choreography sampled live in a Chromium window
at 1280 × 800 — surfaces, transforms and opacities read from the running DOM
mid-handover, and each state captured at rest. One honesty note on that
verification is in §9.

---

## 1. The two faults, diagnosed

**The Settings hop was two entrances stacked.** The shell's outlet is a keyed
`motion.main`; entering Settings played the shell's `VIEW_TRANSITION`
(`opacity: 0, y: 6`) on it — and SettingsPage *also* spread the same preset on
its own keyed pane, to animate section changes. Framer composes transforms
down the tree, so the pane started 12px low with two stacked opacity ramps,
both easing out on the same aggressive curve; ChatPage and ProjectPage have no
nested entrance, which is why the fault was specific to Settings. It ran
concurrently with the sidebar's open spring resizing the container and a
border-radius tween on the same frames — three uncoordinated timelines on one
region, which is exactly what "the right side comes upward from below"
described.

**The conversation switch was the same keyed remount with nothing else.** No
exit, no crossfade, no direction: the old surface was destroyed in the commit
and the new one rose 6px over 180ms. That is the "simple upward-shift
animation" — one device doing all the work, and doing it at a distance too
short to read as anything but a glitch.

Both faults shared a root: the outlet had no exit at all. That was a recorded
decision — the old comment on `motion.main` rejected `AnimatePresence` on the
strength of `mode="wait"`, which would have put a full exit and a full enter
(360ms) between click and arrival, and made navigation depend on an animation
completing. Everything that comment said about `wait` is still true. The
default mode has neither problem, and it is what the new system uses.

## 2. The transition system

- `src/design/tokens/motion.ts` — `VIEW_TRANSITION` is gone. In its place:
  `SurfaceMove` (`'push' | 'pop' | 'sibling'`) and three presets.
  - `SURFACE_PUSH` — drill in: the new surface enters from the right (x 32 →
    0) while the old leaves to the left (x 0 → −24), `DURATION.slow`, the
    house ease. One object serves both roles: the entering element plays
    `initial → animate`, the exiting element plays `exit`, same duration and
    curve, so the handover is one event seen from two sides.
  - `SURFACE_POP` — the mirror image, because back must look like back.
  - `SURFACE_SIBLING` — a pure crossfade on `DURATION.base`, no translation.
    A lateral move between same-depth views gets its sense of travel from the
    sidebar instead (§4).
  - `surfaceTransition(move)` resolves the preset. Distances are a fraction of
    a column: enough to read as movement along an axis, small enough that the
    arriving surface is readable before it finishes arriving. Vertical motion
    was the specific thing that read as a fault — nothing in this app's
    hierarchy is stacked vertically.
- `src/stores/navigation/NavigationProvider.tsx` — direction becomes a fact of
  navigation. Routes are a hierarchy: home 0, project 1, chat 2, settings 3.
  `moveBetween(previous, next)` — pure, exported, unit-tested — classifies
  every navigation: deeper is a push, shallower is a pop, same kind is a
  sibling. The store tracks `move` beside `route`; both update in the same
  commit, so the transition can never describe a handover it was not part of.
- `src/shell/AppShell.tsx` — the outlet is now
  `<AnimatePresence initial={false}>` around the keyed `motion.main`, both
  surfaces absolutely positioned `inset-0` (the top strip is already out of
  the flow, so the page is the container; stacked rather than flowed, the
  outgoing page fades out in place instead of pushing the incoming one down a
  container that would double in height for a quarter second). The old
  decision record is rewritten in place, not deleted: it argued against
  `wait` and it was right, and the new comment says what the default mode
  buys — a crossfade instead of a cut, an exit that runs on its own clock and
  unmounts when done, navigation that still cannot be blocked by anything.
- `src/features/settings/SettingsPage.tsx` — the second entrance is gone. The
  pane now fades only on a section *change* (a `mounted` ref keeps the page's
  own mount from playing it, because the shell owns the page-level handover),
  and the section change is a pure crossfade with no translation — the
  sidebar's selection chip is already travelling to the new section while it
  plays, and a second moving part inside the pane would compete with it.
- `src/shell/sidebar/ConversationRow.tsx` — the conversation list joins the
  sliding-selection-chip device `SettingsTree` already uses: one `layoutId`
  element shared down the column, so switching conversations reads as the
  selection travelling while the page crossfades beside it. The chip paints
  behind the row's content (the menu button is `relative` so it stays above
  it), and the selected row takes no hover tint — the chip is translucent, and
  a tint beneath it would deepen the selection under the pointer.
- `src/features/rail/SideRail.tsx` — the artifact pane's switch had the same
  miniature rise (y 4); it is a lateral move between same-depth views and now
  crossfades like them.
- `src/index.css` — `--duration-slow` and the `duration-slow` utility exist
  now. RULES.md and `DURATION` named three steps from the start; the CSS had
  only two, so a CSS transition on a whole surface had no variable to name.

Reduced motion needs nothing new: `<MotionConfig reducedMotion="user">`
strips the translations and the presets degrade to crossfades on their own.

## 3. The placeholder system

New family, `src/components/placeholder/`:

- `Placeholder` — the bone: a neutral `--selected` field, `overflow-hidden`,
  with the one shared sweep. The sweep — a narrow band of foreground at 7%,
  crossing left to right over 1.8s — is the recipe `MediaArtifact` drew first
  when it argued that a tinted rectangle where an image will be reads as a
  *failed* image. That argument is now the system's; `MediaArtifact` uses the
  primitive, so the app has exactly one implementation of "waiting" to change.
  `sweep={false}` holds a field still where nobody is waiting on it.
- `PlaceholderText` — a line of text, waiting to be text. Height is `1lh`:
  one line box of whatever role the surrounding composition carries, so a
  skeleton row is exactly as tall as the row it becomes and a paragraph
  skeleton stacks without its own gaps. Width comes from the call site,
  varied on purpose — a column of equal bars reads as a pattern, not a list.
- `PlaceholderMark` — the icon tile, sized from the control step, because the
  provider marks that will fill it size from the same scale.

Rules the docblock states and the components enforce: bones are neutral (no
colour — colour claims something about content nobody has seen), bones are
`aria-hidden`, and the loading region announces itself once through
`role="status"` with a spoken label. A skeleton is a picture of the layout,
never a picture of the content.

## 4. The states, wired

The store has always had a phase — `StorePhase: loading | ready | no-harness |
failed` — and nothing read it. A loading index and a failed read both rendered
as the same blank column; two panes answered "nothing" while the answer was
still in flight. The store's own states are now drawn where they are visible:

- `src/shell/sidebar/SidebarStates.tsx` — new. **Loading** holds the rows'
  shape: same padding, same rhythm, widths varied the way titles vary, two
  project groups when the column is organized by project. It lives *inside*
  the list's collapse, under the header — the column's chrome does not become
  a skeleton; only the list does. **no-harness / failed** keep whatever local
  rows exist (the gallery is always among them) and say, above them, why the
  rest is not here, with the remedy: a *Start the harness* button for absence,
  *Try again* for a failed read, both wired to `ensureStore` — the same
  remedy the chat pane's notice offers, offered here because the sidebar is on
  screen before any conversation is.
- `src/features/settings/panes/ArchivePane.tsx` — "Nothing archived." is a
  fact only a read store can state. Loading holds the archive rows' cast
  (checkbox, title, restore); failure names the failure with the harness's
  verbatim sentence; the empty sentence arrives only on `ready`.
- `src/features/projects/ProjectPage.tsx` — same gate on the conversations
  section: rows' shape while in flight, the failure and its remedy when the
  read breaks, and only a ready store may say "Nothing here yet."
- `src/features/settings/providers/ProvidersPane.tsx` — the loading prose
  line became three connection rows' shape (mark, two text lines at the
  caption's own leading, check button), so nothing jumps when the rows
  arrive. The pane's own `LoadFailure` component is gone; it was the right
  shape, and it is now the shared one.
- `src/components/state/StateNote.tsx` — new. The failure note as a system
  component: a title in the surface's voice, the cause verbatim underneath
  ("what did the harness say" is the first question anyone asks), the remedy
  below both. Every failure note in the app now has one shape; `ProvidersPane`
  was promoted into it rather than duplicated beside it.
- `src/features/models/ModelListSkeleton.tsx` — the library dialog's loading
  state holds the list's shape (group label, mark, name, context hint). The
  small transient menus keep their sentence (`CatalogStateNote`): a popover
  that lives for a moment wants a word, not a wireframe.

The store's re-read behaviour already had the other half of the contract and
keeps it: a harness restart re-reads without clearing what is on screen, so a
refresh never destroys content to prove it is refreshing.

## 5. What was deliberately not done

- **The transcript gets no skeleton.** `EarlierBoundary` has a written
  decision — a skeleton "pretends to be content", and text the reader is
  about to read does not get stand-ins. The system is built *around* that
  rule, not over it; the docblocks name the exemption so the next skeleton
  does not land there by accident.
- **The unwired settings sections stay placeholders.** MCP, connectors,
  skills, hooks, git, worktrees, environments have no harness reads to wait
  for; a skeleton there would be a loading state for data that does not
  exist. The pane placeholder already states the honest sentence.
- **Home is untouched.** It is a line and a field, synchronous by design; its
  staggered entrance reads as staging and survives the audit.
- **Surface attachment in chat** keeps its one-line notice. It is a
  connection state with words, not content waiting to render.

## 6. Rules

`src/design/RULES.md` gains section 10, **States** — the named lifecycle
(`loading | ready | no-harness | failed`), loading-is-structural-never-a-
spinner with the bone rules, the verbatim-failure rule, and the two written
exemptions — and section 2 (Motion) now records the handover system: the
hierarchy, the three moves and their distances, why vertical motion on a
horizontal handover reads as a fault, and why a page must never play the
shell's entrance a second time inside itself.

## 7. Tests

Seventeen new, all behavioural:

- `src/stores/navigation/move.test.ts` — the hierarchy classifies every
  navigation: pushes in, pops back, siblings lateral.
- `src/components/placeholder/Placeholder.test.tsx` — bones are
  `aria-hidden`; the sweep is present while waiting and absent when a field
  is merely held; `PlaceholderText` is one line box; `PlaceholderMark` sizes
  from the control step and takes the size the real mark renders at.
- `src/shell/sidebar/SidebarStates.test.tsx` — loading announces itself as a
  status region, not an empty column, and never claims a title; the grouped
  skeleton holds the grouping's shape (headers at the edge, rows indented);
  absence offers the control that starts the harness; failure repeats the
  harness's own words and the retry fires once per press.
- `src/features/settings/panes/ArchivePane.test.tsx` — the empty sentence is
  gated on `ready`; loading holds the rows' shape; failure names the failure
  with the remedy.
- `Sidebar.test.tsx` — the workspace stub gains the phase, pinned to `ready`,
  so the existing column contracts hold unchanged.

## 8. Verification

Typecheck clean. Suite: **401 passed / 41 files**, zero failures, zero
unhandled errors (384 tests before this task). Production build served with
`vite preview`; exercised in Chromium at 1280 × 800.

The choreography was sampled from inside the running page. Mid-handover, the
outlet holds exactly two surfaces, both absolutely positioned; entering
Settings sampled the chat surface exiting at x −23.96 / opacity 0.002 while
the settings surface settled at x 0.05 / opacity 0.998 — the push preset's
own numbers, live. The pop was observed entering from x −32. Every settled
check read exactly one surface: exits complete and nothing accumulates.
The no-harness sidebar (note, remedy, gallery row below it), the settings
tree with the back control in the brand band, and the archive's failure note
were captured at rest — `report/shots/task-42/`.

**An honesty note on that verification.** The browser pane available to this
session reported itself `hidden`, and a hidden page renders no frames —
animations advance on fallback timers, and screenshots can lag the DOM. That
is why the choreography is verified *numerically* (computed styles sampled
from the DOM) rather than only by eye, and why the conversation switch is
proven by the same machinery rather than a mid-flight photograph: every
number the presets define was observed on the surfaces themselves. The
states — note, tree, archive — were captured at rest, where a frozen
compositor cannot lie. In a visible window all of this runs at full frame
rate; nothing in the system branches on visibility.

## 9. Screenshots

`report/shots/task-42/`:

- `01-sidebar-no-harness.png` — the column's absence state: the note, the
  remedy, and the gallery row that survives below it.
- `03-home-settled.png` — the home surface, untouched.
- `04-settings-settled.png` — the new handover's destination: tree in the
  column, back in the brand band, the pane perfectly still — no hop.
- `05-archive-no-harness.png` — the archive naming its absence with the
  remedy beside it, where it used to say "Nothing archived." to a store it
  had not asked yet.

## 10. Additional — the exit that replayed the wrong move

A fault in the transition system this task built, found after the task
closed: the model library's frame-by-frame sampling (TASK 43) caught it,
because a drill-in and its back play in one dialog there — the first place
the same surface ever played two different moves.

**The fault.** AnimatePresence freezes an exiting element's props at its
last render, so a spread `exit` replays the *previous* move, not the one
the navigation just asked for. Drill into a model and press back, and the
model page left toward the *left* (the push preset's exit) while the
family page entered from the left (the pop preset's entrance) — two halves
of two different gestures in one handover. The shell's own route handover
carried the same latent fault: pop out of Settings and the outgoing page
left the wrong way. Nothing here caught it because every exit had only
ever been sampled playing the first move its surface saw.

**The fix** is the channel AnimatePresence *does* re-render onto exiting
children: `custom`. `tokens/motion.ts` gains `surfaceVariants()` — the
push / pop / sibling presets as variants whose poses re-read the move at
play time — and the shell's outlet passes the move as `custom`. RULES §2
now states the rule that came out of it: **a direction-aware exit must
receive the move through `custom`.**

**Verified by sample.** After the fix, the pop's exiting surface runs
0 → +10.8 → +24 while the entering surface runs −24 → 0, and both routes
settle at exactly one mounted surface in each direction — the same
numeric method §8 used, applied to the handover's return trip.
