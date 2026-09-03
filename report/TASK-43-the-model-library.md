# TASK 43 — The model library

Brief: completely redesign the Model Library — the dialog behind the picker's
"Model library…" door. The old page was a two-pane split: every model of every
connection in one continuous list on the left, a details panel on the right
that waited empty until a row was clicked, and one scroll that kept moving
underneath the other. The brief asked for a library rather than a list:
organized by model family, minimal and editorial, information-rich without
clutter, no preserved split-screen, no empty details pane, and one motion
language shared with the rest of the app.

Verification: `tsc -b` clean; vitest **420 passed / 44 files, zero failures**
(twenty new tests written for this task, plus the picker's thirteen
re-walked); `vite build` clean; every level walked live against a stub
harness in Chromium at 1280 × 800 and at 750 px, with the handover motion
sampled frame-by-frame from the running DOM (§6).

---

## 1. The information architecture

**Category → Models → Details, as pages.** The library is now three levels:

1. **The landing** — one card per family: the vendor's mark, its name, how
   many models it holds, and the connections serving it. A quiet stat line
   above the grid states the catalog's size ("14 models · 11 families · 2
   connections"). The catalog's *shape* is the opening page, not its rows.
2. **The family page** — the family's facts stated once in a header (mark,
   name, count, "via OpenRouter · Work Anthropic" when more than one
   connection serves it), then one row per model: name, the capabilities
   that actually separate siblings (`tools`, `vision`, `reasoning` — only
   when confirmed supported), the context hint, and the price pair. Rows
   repeat nothing the header already said.
3. **The model page** — the full wire record, in reading order: a back row
   named for its destination, the name at title size with "by Anthropic ·
   via OpenRouter" under it, a two-column stat grid (context, max output,
   input / output / cache-read / cache-write per million), the capability
   chips, the reasoning dial for models that have one, and — under a
   hairline, because it is metadata rather than a decision — the id a
   request actually carries ("Sent as `openrouter/anthropic/claude-opus-4.1`").

**The family is the author, not a new taxonomy.** Every catalog row already
carries `author` — the vendor whose mark the model wears (`anthropic/...` in
an OpenRouter id; a direct connection is its own vendor). Grouping by it is
the catalog's own categorization read out, which is why no second hierarchy
had to be invented or maintained. One family can be served by two
connections (Anthropic directly and through OpenRouter are one family); the
connection appears at the family level, and on a row only when the family
spans more than one.

**An index keeps the hierarchy one click wide.** A left column lists the
landing ("All families") and every family with its mark and count. Family to
family never climbs back through the landing; the index's selection chip
slides between rows with the same spring pattern the sidebar established
(own `layoutId`, so the chip cannot fly between the dialog and the sidebar
behind it).

**Search crosses families.** The field rides above every page. A needle
turns the stage into results grouped under family headings — the one view
that is not one family deep — and the index stops claiming a family is
selected while it shows. Opening a model from results keeps the needle in
the field; the model page's back row is then named "Search results" and
returns there. No matches states the fact with the needle in it.

## 2. What was removed, and why the drill-in is the answer

The old layout's defects were structural, not cosmetic:

- **The shared scroll.** One pane's scrolling continued underneath the
  other because both lived in the dialog's single scroll body. Each page
  now owns the stage outright and scrolls alone; the handover is a change
  of fill, not a scroll fight.
- **The empty details pane.** A panel that waits for a selection is a hole
  with a sentence in it. A page reached only when a model exists has no
  empty state to design — the argument that killed the split screen is the
  same one that chose the drill-in.
- **The wall of models.** Against an aggregator the list was two hundred
  rows before a single fact sorted them. The landing sorts first.
- **Duplication.** The old row carried the author's mark beside a
  connection-named group header that carried it too; family pages now say
  the family once.

`groupCatalog` and `CatalogGroup` — the connection grouping that existed
only to build the old list — are deleted. Their replacement lives in
`domain/models/families.ts`: `familyCatalog` (grouping plus numeric-aware,
alphabetical ordering), `familyName` (the vendors' own display names for
the ids that arrive in practice, title-cased fallback for the rest),
`connectionsOf`.

## 3. Compactness rules

The at-a-glance facts are compressed, not omitted:

- **Context** prints as the spec sheet does — `200k`, `1M`, `2.5M` — and the
  detail page prints the exact figure with separators.
- **Price** pairs input against output (`$3 / $15`), per million implied;
  whole dollars stay whole, cents keep two places trimmed of zeros
  (`$0.25`, `$0.6`). The page prints `$3.00 / M`.
- **Unknown is answered with absence on a row** (a column of dashes where
  the point is the models that do name a price is noise) **and with an em
  dash on the page** — shown rather than hidden, the wire's own answer.
- **Capability words on a row** are only the confirmed, family-differentiating
  three; the unknowns and full board wait for the page. `Tool calling`
  compresses to `tools`.
- All figures are `tabular-nums`, so a column of prices does not shimmer as
  the eye moves down it.

## 4. The motion bug the redesign surfaced

Sampling the handover frame-by-frame caught a real defect that predates
this task: AnimatePresence freezes an exiting element's props, so a spread
`exit` replayed the *previous* move — first here, then found latent in the
shell's own route handover. The fault and the fix (`surfaceVariants()`,
the move passed as `custom`, shell included) belong to the transition
system Task 42 built, so the full record lives there: **TASK 42, §10
"Additional — the exit that replayed the wrong move."** What this task
contributed is the finding, the two RULES §2 entries (the `custom` rule
and the drill-down exception that got the library its push/pop), and the
sampling method §6 uses.

## 5. States

The named lifecycle applies here like everywhere else:

- **Loading** holds the room: index bones on the left, search field, stat
  line and six family-card bones on the right (`LibrarySkeleton`), one
  `role="status"`, no spinner. It replaces `ModelListSkeleton`, which stood
  in for the old list's shape.
- **No harness / failed** replace the whole body with `StateNote` and the
  remedy as a control — "Start the harness" / "Try again" through
  `ensureStore`, the failure message verbatim from the wire.
- **Empty** (a catalog with no chat models) says "No models to browse yet.
  Add one in Settings." — an absence naming itself, next to the footer
  button that does the same thing.
- The transcript-exemption and menu-prose decisions are untouched; the
  picker's first level keeps its sentence, the library gets the bones.

## 6. How it was verified

A stub harness (plain `node:http`, temp directory, never in the repo) served
a fourteen-model catalog over two connections — enough vendors to exercise
the name table, numeric sort, multi-connection families, free models,
unknown capabilities, and million-token contexts — under `vite dev` at
127.0.0.1 with the dev-only env pair. The first catalog read failed parsing
in the app while a `tsx` harness-side check claimed the payloads were fine;
the discrepancy was a stale server still holding the port during a restart,
and the real fault was a fixture whose pricing omitted `cacheRead` /
`cacheWrite` — the parser demands all four keys. Both fixed fixture-side.

Then, in the browser: the landing, family, detail and search pages walked
and captured; the no-match sentence asserted; the narrow window (750 px
viewport) shows the index collapsed to its marks; and the handovers were
sampled with `requestAnimationFrame` from the live DOM — transform x and
opacity per frame per surface — which is how §4's bug was found rather than
assumed. Screenshots in `report/shots/task-43/`.

One limitation, stated: the in-app browser pane will not go below ~380 px,
so the marks-only collapse was verified at 750 px inner width (the media
query is on the window, the rule confirmed present in the generated CSS at
exactly `width < 48rem`) — not at the 620 px floor the packaged window
allows.

## 7. Tests

Twenty new:

- `domain/models/families.test.ts` (7) — grouping across connections,
  ordering by proper name and numeric model name, the name table and its
  fallback, `connectionsOf` deduplication, the empty catalog.
- `features/models/library/views.test.ts` (5) — push/pop/sibling
  classification, the search priority rules, distinct view keys.
- `features/models/library/format.test.ts` (8) — context hints and exact
  figures, the two price forms, unknown handling, row capability words.

The picker's suite (`TurnMenu.test.tsx`) was re-walked to the new IA: the
landing names the family and hides the rows; search narrows under family
headings; the facts, the reasoning absence, the explicit-button PATCH, the
recents cap and the dial all walk landing → family → model → Use now.

## 8. Files

New: `domain/models/families.ts`, `features/models/library/{views,format,
LibraryIndex,FamilyGrid,FamilyModels,ModelRow,SearchResults,ModelDetail,
LibrarySkeleton}.tsx|ts` (+ three test files).

Rewritten: `features/models/ModelLibraryDialog.tsx` (frame, page state
machine, footer, states), `shell/chrome/TurnMenu.test.tsx`.

Touched: `components/primitives/Dialog/Dialog.tsx` (optional `height`, so a
sheet whose columns scroll independently can have a definite box),
`shell/AppShell.tsx` and `design/tokens/motion.ts` (`surfaceVariants` +
`custom`, §4), `design/RULES.md` (the custom rule; the drill-down
exception), `domain/models/catalog.ts` (dead grouping removed).

Dialog width stays `min(72rem, 74vw)`; height is `min(46rem, 100%)` — a
browsing page, capped so it never pretends to be the whole app.
