# TASK 62 - Crisp fields and the gallery

Brief: The person using the forms read the settings fields' focus treatment as "a thick, old-fashioned light-grey outline" and judged the server dialog's two equal-weight buttons unpretty. The request: fix the specific bugs first, on this branch, and build a way to see and judge every component the app has — without adding a page to the shipped software. The gallery is the instrument for the larger design pass that follows: one component at a time, judged on the real tokens, then taken into the software.

## The analysis that chose the bugs

The design is a strictly monochrome register system: white ground, near-black ink, and greys that differ by *job* — translucent `--tint`/`--selected` answer hover and press, opaque `--muted` grounds chips and code, `--hairline` draws every border. Hue exists only for danger, diff-add, and the voice state. That system is applied consistently: a grep of every `hover:` utility found zero `hover:bg-muted`; the tint rule held everywhere. The "two different situations" the person saw are the two registers (translucent response vs opaque ground) doing different jobs on one page, not an inconsistency.

What actually failed were two treatments:

1. **Field focus.** The field answered focus with a border shift *plus* a 2px halo of grey (`--field-ring`). A docblock confessed one earlier fix attempt (3px at 26%, then 2px at 14%) — and the person still read it as a thick error outline. The lesson: a monochrome halo cannot borrow hue to say "focus, not warning", so no alpha is small enough. The edge has to say it.
2. **The ServerDialog footer.** Four of the app's five dialogs follow ghost-cancel + one primary/danger confirm. ServerDialog wrapped two equal-weight `size="sm"` secondary buttons in a redundant div — the one violator.

## Implemented

### The fields answer with their edge (`STUDIO/src/components/primitives/Field/TextField.tsx`)

- BASE now reads `transition-[border-color] duration-fast focus:border-foreground/45` — the same one-pixel border, deepened to the weight `--ring` already established. The `box-shadow` bloom is gone from the transition list.
- The docblock states the reasoning: halo at two weights failed the same person the same way; the border is the focus indicator, for mouse and keyboard alike, drawn inside the field's own box so no clipping ancestor can cut it.
- `TextArea` shares BASE, so the fix propagates. No API change; `ServerDialog.test.tsx` queries by role/name and passes untouched.

### The dead token removed (`STUDIO/src/index.css`)

- `--field-ring` deleted from both palettes. Grep confirms zero remaining references. The light palette's focus paragraph now records the rule: focus is answered by the field's own border, the whisper bloom is gone on the person's word.

### Law and paint agree (`STUDIO/src/design/RULES.md`)

- §1's focus paragraph now reads: "Focus is answered by register, not by one treatment. A control answers with an edge — its border deepens, and that is all." with the monochrome-can't-say-focus reasoning. RULES.md is source, editable, unlike `documentation/`.
- `Composer.tsx`'s focus comment updated to name the same register, so the one component that intentionally answers differently (it is a surface, not a control among controls) states why.

### The dialog footer follows the house pattern (`STUDIO/src/features/settings/mcp/ServerDialog.tsx`)

- Footer is now `Button variant="ghost"` Cancel + `Button variant="primary"` Add server/Save, no wrapper div, matching the other four dialogs.

### The gallery — a dev-only second Vite entry

- `STUDIO/showcase.html` at the app root, `STUDIO/src/showcase/main.tsx` + `Showcase.tsx`.
- Why this shape: the person rejected both a standalone HTML file and a new route in the app. A second entry solves it cleanly — Vite's dev server serves any root `.html`, while `vite build` takes only `index.html` as its input, so nothing ships: not in the router, not in the bundle, not in the installed app. It runs in the plain browser against the already-running dev server at `/showcase.html`.
- It mounts the real providers (`MotionConfig reducedMotion="user"`, `AppearanceProvider`), so theme and text-size switching drive the real tokens; theme works outside Tauri because `applyAppearance` falls back to localStorage.
- Sections: Buttons (four variants × normal/disabled/busy/marked, all sizes, full-width), Icon buttons (sizes, active, disabled), Fields (empty/filled/secret/area — click in and judge the edge), Segmented + StepSlider, Overlays (tooltip both sides, popover with the full menu anatomy, dialog with the fixed footer), States (loading skeleton, failed-with-verbatim-cause + retry, empty), Colour registers (all 14 tokens as swatches, translucent ones over card), Type roles, Elevation (the five shadow steps), Motion (duration/spring readout plus live collapse, fade, and push/pop/sibling surface demos that exercise the `custom`-driven exit direction).

### Test guard extended, not weakened (`STUDIO/tests/palette-usage.test.ts`)

- The showcase's `text-display` was the first src use of that spelling and tripped the palette test — correctly, since it resolves nothing (see issues). `display` joined the typography false-positive line in `NOT_COLOURS`, the one-line addition the test's own docblock prescribes for words that follow a colour prefix without being one.

## Issues found

- **`text-display` is not a utility.** The type roles are hand-declared classes in `@layer components` (`.text-micro` … `.text-title`); there is no `.text-display` — the display size travels with the serif in `.studio-display`. The showcase invented `text-display` as if it were a Tailwind role and got a 12px serif heading — silently, exactly the failure the `.text-code` note in `index.css` documents from its own history. Fixed by using the real vocabulary: `studio-display` for the page's one statement, `studio-heading`/`text-title` for headers. The browser check that caught it (h1 computed at 12px) is the only reason it did not ship inside the gallery.
- **A transparent ground dims white text.** With correct computed colours, the gallery's headings still painted faint over the browser's dark canvas, while the app's identical `studio-display` h1 painted crisply. The difference was the ground: the app never sits on transparency — every surface paints its own `--surface` — and the browser's dark canvas auto-dims ungrounded white text. The gallery root now carries `bg-surface text-foreground` like any real surface. This is also a finding about the app: nothing in it ever relies on the window background, which is why the defect was invisible in the shipped app.
- **The popover trigger owns its own onClick.** The gallery's first popover did not open: the primitive deliberately leaves trigger wiring to the caller (every real caller attaches a toggle), and the demo had passed a bare button. Fixed in the demo; the primitive is right.

## Flagged, not changed

- `Button`'s `whileTap` scales to 0.97, and RULES.md §1 says "the button does not move". One of them is wrong and it is the person's call — it is visible in the gallery, where such verdicts are now meant to be made.

## Outcome

- Frontend typecheck, lint, and the client suite pass: 905 tests, 85 files, including the palette-usage guard with its extended allowlist.
- Verified live in the browser against the running dev server, dark and light: headings crisp on both grounds, focus deepens the field's border to `foreground/45` with no bloom, the dialog footer reads ghost/primary, the popover opens with its full anatomy, the theme and text-size controls drive the real tokens, and the console is clean.
- The gallery opens at `http://localhost:1420/showcase.html` while the dev server runs. Nothing is added to the shipped app.
