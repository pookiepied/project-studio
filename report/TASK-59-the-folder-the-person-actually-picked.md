# TASK 59 - The folder the person actually picked

Brief: adding a folder to a project does not open a file dialog; it invents a
path (`D:/Work/<slug>`). This task swaps the fabrication for the real OS
directory picker - the Tauri dialog plugin added on both sides, registered,
granted exactly the one operation the feature uses, and `addFolder`'s body
replaced with the call, doing nothing at all on cancel.

**Status of this report.** The formal task above is **not implemented yet**.
It was always sequenced second: the instruction for this stretch of work was
that TASK-59 would be completed and reported *after* a body of user-requested
interface work landed first. That work grew long enough to be worth its own
record - components, sources, decisions and all - so this report was written
early, at the person's request, with the additional work captured in full
while it is still fresh. The formal task's own sections will be filled in
when it lands; nothing below claims it.

---

## Additional implementation based on user request

Everything in this section was asked for directly, session by session, and
verified live each time - the person is the visual verifier; the suites and
the measured computed styles are the reproducible half. Source libraries
drawn on, in the order they arrived:

- **aicss.dev** - the component registry the whole integration is patterned
  on: `thinking-reasoning`, `approval-card`, `file-diff`, `data-table`,
  `comparison-table`. Grammar and proportions only; every colour, token and
  construction is the studio's own.
- **beautifului.dev** - the tool-chip pattern (action verb, file, status).
- **transitions.dev** - the `number-pop-in` digit animation.
- **Simple Icons** (CC0) - nine vendored single-path language glyphs.

### A. The aicss foundation: thinking, alignment, entrance

- `ThinkingBlock` rebuilt on aicss's pattern: the live reasoning trace gets
  its own mark (`thinking: Lightbulb` in the icon registry - an idea arriving;
  the gauge stays "how hard to think", one mark one concept), the brand mark
  came off it (StudioMark stays shared: splash, sidebar, between-turns,
  EarlierBoundary, HarnessDownPage), and the trace's label shimmers - the
  app's "one moving thing" language, via the new `.studio-shimmer`
  (gradient-over-text, `@supports`-guarded, token-timed).
- `DisclosureRow` - the one row shape every secondary line of a reply shares:
  content-boundary rule (a row's first painted element sits flush at the
  message edge; `pl-*` on the button is the regression the tests hunt),
  chevron `always`/`hover`, FADE entrance gated on arriving with a live turn,
  and a `flush` body variant (no rule, no indent) for bodies that are their
  own framed card. Written once because thinking and tools had drifted apart
  by two pixels each.
- `--row-label-inset` token; five hand-computed `pl-[calc(...)]` indents
  replaced (thinking, tool rows, retry, failure reasons). Reusable fix, no
  per-component hacks.
- Reasoning-level mark collision fixed in the registry (`reasoning: Gauge`
  was doing two jobs); `assertUnique` remains the dev-time guard.

### B. The turn-status capsule

`TurnStatus` (replacing TurnInFlight): appears the moment words are sent -
"Sent — waiting for the model to reply" through the pre-first-token silence,
"Working on your reply" for the run, "Done" for a 3-second beat when a run it
*witnessed* settles complete, then a reverse-animated exit. The witness rule:
a pill that mounts after a run already finished confirms nothing. Gated off
the gallery. Twelve tests including the witness rule and the same-render
retake.

### C. The approval and question cards

- `CardShell` rebuilt in the aicss approval-card form: head tile carrying the
  `ask` mark (a speech bubble with a question mark - a conversation that has
  turned and is waiting on you), entrance animation, sentence, options as
  lifted chips with letter keys, countdown preserved.
- The dark-mode invisible-text defect, found by measurement after two rounds
  of treating symptoms: **the app sets no default text colour anywhere**, so
  an uncoloured surface inherits browser black. `text-foreground` on the card
  root is load-bearing, and every surface built since carries it with a
  comment saying so.
- `Button` gained the `xs` pill size; verdict buttons across
  `ApprovalPrompt` and `QuestionPrompt` moved to it (the old buttons were
  oversized); inline code on the permission card uses `bg-muted`, not the
  code-panel token (which darkens in dark mode).
- **`text-destructive` never existed as a token** - four error surfaces
  (tool rows, AssistantTurn, ConnectionNotice, SubmissionFailed) used a class
  that resolved to nothing, so error text silently inherited the row colour.
  Migrated to the house `text-danger`.

### D. Tool chips (beautifului pattern)

`ToolGroups` rebuilt: the collapsed per-kind count line is gone; **every call
renders as its own chip by default** - action mark, verb, file-type mark,
file name with the directory beside it, and the diff count when the call's
own input carries one.

- **Keyed on the action, not the tool** - and the map is the harness's real
  registry, read from source (`application/tool-name.ts`, `tools/*`): read,
  write, edit, shell, git, glob, grep, web_search, fetch, plan,
  ask_user_question. The first draft guessed `bash` and `list`; both are
  wrong for this harness, and `shell` was rendering as a raw unknown name.
- Verb tense is a fact: running ("Editing") vs answered ("Edited"); unknown
  tools render under their raw name, never a guessed verb.
- Marks: `fileRead` (BookOpen), `fileWrite` (FilePlus), `run` (Terminal)
  added to the registry; `edit` (Pencil), `search`, `branch`, `plan`, `ask`,
  `browserUse` reused on their existing concepts.
- `FileTypeMark` + `fileTypeOf` (`src/components/icons/fileTypes.tsx`):
  vendored Simple Icons paths (TypeScript, JavaScript, React, Python, Rust,
  HTML, CSS, Markdown, JSON), monochrome via `currentColor` - the shape
  carries the language, not brand colour. Unknown extensions fall back to the
  registry's generic file mark; the map refuses to guess.
- **Line numbers in diffs are printed only when they are true**: a whole-file
  `write` is the file (1..n); an edit's position in the file is nowhere in
  what the model sent, so its gutters stay empty.
- `diffLines` - LCS line diff with an honest over-budget fallback (block
  replace, never a wrong minimum); extraction is by field name only, and the
  harness's real field names are camelCase (`oldString`/`newString`) - the
  snake_case guesses were why edits showed no diff at all for a day.
- `FileDiff` - the aicss file-diff grammar on studio tokens: `--code-surface`
  well, `--diff-add`/`--diff-del` notation tokens (the third documented hue
  exception; deletions alias danger), per-mode tint grounds, hatched deletion
  bar (`.studio-diff-del-bar`), full-height gutter divider, direction-tinted
  numbers, flush body.
- `RollingCount` - the `+N` on a live chip counts up from zero to the fact
  with per-digit pop-in and shimmer. Documented honestly: the wire delivers
  tool input whole, so the ramp is the chip's entrance, not a progress report,
  and history renders settled.
- Honesty fixes found on the way: a call whose turn is over and whose answer
  never came reads **"pending"**, not "running"; the harness's answer strings
  render as themselves (read's numbered lines, shell output) instead of
  JSON-quoted debris; under a diff card the harness's status sentence
  ("Created snake/script.js") stands alone without the `out:` prefix.
- **The ask answer is part of the record now.** The question call's own
  output carries what was answered; the "Asked" chip names the first question
  header with the count, and expanding it shows each question with the exact
  answer - chosen option label or custom words - in the foreground, or what
  happened instead ("You decide" / "Stopped" / "Timed out").

### E. Message actions do not surface mid-run

Copy / Branch / Read aloud used to hide only while the newest message was
mid-write; a message can be complete while its run is parked on a question or
a permission, and that is exactly where the row was appearing below the tool
chips. `turnInFlight` (the phase's submission id, matched per message) keeps
the row down for the whole in-flight submission; everything said before it
keeps its verbs.

### F. Code and text blocks

- The old `BlockFrame` was a preview: past 360px, content faded out behind a
  gradient mask and the clipboard was the way back. Useless in a coding
  session. Rebuilt: **the artifact container** (sunken ground, one radius, no
  border, no shadow - `ArtifactShell`'s box), a head with the language mark,
  the file name (fences may carry `lang:path`), the line count and the
  standard copy button, and a body that scrolls inside a cap instead of
  fading. Nothing is hidden.
- `CodeBlock` unwraps lines (wrapped code misreads structure), and numbers
  them through the highlighter's own gutter - unselectable digits, sitting
  closer to the frame's edge than the code sits to the gutter.
- `TextBlock` - prose-as-object in the same container: named, copyable, no
  code furniture. **An unlabeled fence is a text block now**: routing moved
  from the `code` component to `pre`, reading the fence off the tree, which
  is why plain ``` blocks used to fall through to inline-chip styling and
  render as a grey pill, or seem not to render as a block at all.
- Vertical cap 288px, no fade; `.studio-scroll-frame` keeps the scrollbar
  thumb out of the rounded corners on both axes (the per-frame version of
  the page scroller's inset rule).

### G. Tables

- Edge-to-edge header band: the wrapper's padding made the band float inset,
  reading as a centred bar never scaled to the container. The inset belongs
  to the cells; the band touches the frame's own corners (the per-cell radius
  rules keep the corners turned).
- Column rules (hairline between columns, first column exempt) - the aicss
  tables' grid reading, which ours lacked entirely.
- **The header band is a per-palette token, `--table-head`**, because the
  direction of "distinct" inverts: dark lifts (`--surface-raised`, 0.235 over
  the 0.164 ground, measured - and clearly off the page background, which at
  0.205 was the original bug: the band *was* the page colour), light dips
  (4% foreground over the ground ≈ 0.946 on 0.979, measured). Two single
  formulas were tried and measured before this conclusion; both failed one
  palette. Opaque, sticky, rows pass under it.

### H. Pipeline repairs (found by reading the render stack)

- **KaTeX was split-brained**: the app declared `katex@^0.18.4` while
  `rehype-katex@7` renders with `^0.16` - two copies installed, formulas
  built by 0.16's HTML and painted by 0.18's CSS. Aligned to a single
  `katex@0.16.47`.
- **Inline SVG was deleted whole**: the sanitiser's default schema has no
  `svg`, so a drawn illustration was parsed and removed. Now a curated
  allowlist - shapes, gradients, clips, text, both name spellings - with
  `script`, `foreignObject`, event handlers and outbound `href` refused, and
  a test proving a script inside an svg is stripped while the shapes survive.
- The math pipeline itself (`remark-math` → sanitiser (math classes
  allow-listed) → `rehype-katex`, CSS imported) verified working end to end
  by a `.katex`-output test.

### I. Verification

- Test count at the start of the additional work: **604 passing**. At this
  writing: **746 passing across 72 files**, `tsc -b` clean, production build
  clean, at every landing.
- Every load-bearing claim above was negative-controlled at least once:
  broken by hand, the named test watched failing, restored and re-run green
  - the LCS tie-break, the dark-mode `text-foreground`, the verb tense, the
  extension map, the flat-chip default, the flush diff body, the count ramp,
  the string-answer rendering, the camelCase edit fields, the chip entrance
  fade, the ask answer line, the in-flight action-bar gating (twice - the
  first control's test did not exercise the fix, so the test was
  strengthened until the break bit), the unlabeled-fence routing, the
  language glyph map, the svg allowlist, the line numbers, the frame
  scroller class, the anchored gutters, the echo slab, the table's
  scroller class, the java mapping, the sql stand-in, the run walk, the
  net chain, the standing tick, and the pasted screenshot.
- Computed-style measurements on the live stylesheet (both palettes, via a
  fixture) settled every colour question: the chip colours, both table-band
  failures, and both fixes.

### J. Found, deliberately not done

- **The animation-and-smoothness pass over the earlier components**: the
  first slice landed - the tool-row entrance (N) and the ticking run
  counters (N) are in. The rest of the pass - entrances for things that
  appear in multiples elsewhere, rolling numbers in other live surfaces -
  remains requested and pending.
- The edit tool's own output carries the changed region **with real line
  numbers**; parsing it would give edit diffs truthful file-line numbering
  instead of empty gutters. *Done since - see K.*
- The harness streams no tool input, so a *live* write-progress count would
  need harness work; the count ramp is entrance pacing.
- Chips render in bucket order (by kind), not strict wire order; equal in
  practice, restated here so a future interleave complaint has its answer.
  *Retired since - see N: rows now sit in wire order.*
- The web page (vite served to a browser) cannot see harness state - the
  Tauri app is the only honest verification surface, confirmed the hard way.
- **A net on every run, guaranteed**: needs the harness to capture pre/post
  file content per mutating call and ship it in the outcome - assessed in
  N, deliberately not built; the corroboration net with the labelled churn
  fallback is the UI-only honest version.
- **Attachments beyond images** (the drop of a pdf, a csv): the harness's
  attachment wire carries images only, so the composer's rules refuse the
  rest by name (O). General file attachments are harness work, not
  composer work.

### K. The edit answer's echo: real line numbers, and the slab gone

Symptom (user screenshot, the snake-game chat): expanding an "Edited
snake/script.js" chip showed the diff card and then a numbered slab of the
file under it - reading like the whole file rendered into one of the new
code blocks, on a call the chip itself called a one-line edit.

- **Root cause, found in the stored transcript** (`~/.studio/data/flue.db`,
  conversation `cnv_7zredl25`): the harness's edit answer is not only a
  sentence. It is the sentence, then an echo of the changed span of the
  post-edit file, numbered - `   197→function drawFood(now) {`. The
  expansion printed that answer verbatim under the diff card: the change
  twice, the second copy a wall of code. Write answers really are sentences
  only ("Created snake/index.html", "Created directory snake, which did not
  exist."), which is why only edits flooded.
- **The fix is symmetrical by shape.** `editOutcome.ts` parses the answer
  into its sentence, any extra prose, and the numbered echo. The sentence
  and prose still render under the card - write's second sentence carries a
  fact the card does not. The echo is never printed, because it already is
  the card: and since the echo is the only place the span's file position
  exists, `anchorToRegion` lifts its numbers into the card's gutters,
  accepted only when the echo corroborates every context and added row line
  for line - one line of drift, one echo that covers only part of the
  strings, and the card falls back to the honest empty gutters it printed
  before. The snake edit now reads 200 (removed) and 200-204 (added), the
  harness's own numbers, instead of nothing.
- This retires the flag in J about the edit output's real line numbers.
- Files: `STUDIO/src/features/chat/transcript/live/editOutcome.ts` (new);
  `ToolGroups.tsx` (parse once, anchor the diff, render the sentence only);
  doc comments in `diffLines.ts` and `FileDiff.tsx` no longer claim edit rows
  never carry numbers. Tests: `editOutcome.test.ts` (new, 8 - parser shapes
  verbatim from the real transcript, corroboration, candidate anchors,
  both honest fallbacks); `ToolGroups.test.tsx` +3 (gutters carry 200/204,
  the echo slab is absent, the write sentence stays).
- Negative controls, both observed failing by name and restored: anchoring
  disabled by hand fails the three anchoring unit tests and the gutter-number
  component test; the echo regex broken by hand leaks the slab into the
  prose and fails the "does not print the echoed span again" test.
- 706 → 717 passing across 71 files; `tsc -b` clean; production build clean.

### L. The frame scrollbar, defined

The user reported three things at once: the sideways-scroll insets looking
"not applied" on the first code block of the Python weather conversation;
the visibility question (always vs on hover) feeling unanswered; and the
vertical track's top inset being wrong, since a frame's head already caps
its scroller's top.

- **The insets were shipped and being served.** Measured the live page
  before changing anything: both track rules present in the stylesheet,
  `CSS.supports` parses the `:horizontal` track selector. The user's window
  simply had not taken the update - a reload (or the full fresh restart they
  then planned) is the whole fix for that part. Conversation age is
  irrelevant: the treatment is global CSS, and a block only shows a
  horizontal bar at all when its longest line actually overflows.
- **The definition, now written into the stylesheet**: frame bars are ALWAYS
  drawn when the content overflows - a dimensioned `::-webkit-scrollbar` is
  a classic non-overlay bar, so sideways code never waits for a scroll or a
  hover to reveal how it is reached. The thumb rests as a quiet pill (16% of
  the foreground) and lifts on hover (28%).
- **One treatment for every frame.** The quiet 8px pill language the table
  had through `.studio-scroll-x` is folded into `.studio-scroll-frame`
  itself, so code block, diff card and table share it and the table drops
  the extra class.
- **Vertical track inset is bottom-only** (`margin-block: 0 var(--radius-lg)`):
  the head (file name, copy row) already caps a frame's scroller, so a
  second gap there read as the thumb starting short. Horizontal keeps the
  left/right insets.
- Files: `index.css`, `Markdown.tsx` (table wrapper), `blocks.test.tsx`
  (table asserted on the frame class, without `studio-scroll-x`). Negative
  control: the old class re-added fails "sets a table on the sunken ground"
  by name; restored, re-measured live after HMR.
- Suite 717 passing; `tsc -b` clean; production build clean.

### M. A mark for every language the writer emits

Symptom (from the fresh-run checklist round): the model was asked to write
demo files in twenty languages; only Python, JavaScript, TypeScript and Rust
(plus JSON/CSS/HTML) earned file-type marks - nine marks were vendored, and
every other language fell to the generic file. Also raised in the same
breath: the marks read heavy on the chips, and a `Dockerfile` - no extension
- could never earn one.

- **The marks**: the official Simple Icons v11 tarball (CC0, the same source
  as the original nine) was pulled and 25 more paths vendored - C, C++, C#,
  Java, Go, Ruby, PHP, Swift, Kotlin, Scala, Dart, Perl, Haskell, Lua,
  Julia, Elixir, GNU Bash, Docker, Clojure, F#, GraphQL, PowerShell, R,
  Solidity, Zig, TOML. Java's mark is **OpenJDK's**: Oracle's own logo was
  withdrawn from Simple Icons, and the reference implementation's mark stands
  for the language. MATLAB and Objective-C have no published mark and share
  `.m` besides, so that extension deliberately falls to the generic file
  rather than a coin flip. Extension coverage: 17 → 56 spellings.
- **Dockerfile** is read by its basename, case-insensitively - the first
  file whose kind lives in its name rather than its suffix.
- **The weight**: the marks sat at 1.1em - a tenth ABOVE their text, the
  rule for the app's thin line icons - which is exactly why solid fills
  read heavy on a chip. They now sit at 1em, the text's own size.
- **Code-block headers** now key the glyph on the fence's own word
  (`markOfName`): a fence names a language, not a file, and the old path -
  resolve the language through the highlighter first - degraded every
  unregistered language to the generic coding mark, so ```java could never
  carry a mark no matter what the map knew. Now it does; a new exported
  `Mark` component serves callers that hold the mark's name.
- Tests: fileTypes 6 → 9 (the demo-garden extension table, the Dockerfile
  basename, the `.m` refusal, `markOfName` with its aliases - `cpp`, `c++`,
  `c#`, `f#`); blocks +1 (an unparsed language's header still carries its
  mark). Negative control: the java mapping broken by hand fails "covers the
  demo garden" and "keys on the language word" by name; restored.
- 717 → 721 passing; `tsc -b` clean; production build clean.

### N. The file run: one row per same-file burst, numbers that tick

The brief came from another LLM; the parts below are what survived contact
with this codebase, after the assessment the user asked for before anything
was built. The one place the brief assumed something false - "you probably
already capture pre-state snapshots to render per-call diffs" - is called
out in its own subsection.

- **The row unit changed** (`projection.ts`): a tools segment is now a list
  of ROWS, not name-buckets. A row is either a RUN - a maximal line of
  consecutive, same-file mutating calls (`edit`/`write` with a path in the
  call's own input) - or a single call standing alone. Reads never join and
  never break a run (the retry pattern re-reads mid-edit), but they stand
  between runs as their own rows, so wire order stays readable; a
  different-file mutation closes the run for good; a, b, a is three rows,
  never two. The walk is one function shared by the live stream and the
  history seed, and the row ids are derived - a replay builds the character-
  for-character rows the live turn grew, so nothing remounts. This also
  retires the old documented wart that chips rendered in kind-bucket order:
  rows now sit in wire order.
- **The numbers tick in place** (`RollingCount`): a live count now ramps
  FROM where it stands - the mount still arrives from nothing, but a run's
  second edit climbs 5 to 7 to 9 instead of restarting the entrance. This is
  the actual fix for "the number never goes up": every call used to spawn a
  brand-new row, so there was nothing to tick.
- **Net, not summed - with the honest fallback** (`groupNet.ts`): the
  header's diffstat is the diff between two provable states of the file.
  Nothing on the wire carries snapshots, so the states are reconstructed
  from the calls' own inputs and trusted only while provable: a write
  anchors a whole file; each edit's anchor must be found, character for
  character, in the text the run produced so far. When the chain holds, the
  header shows the NET (tooltip says so) - a run that reworks its own work
  reads +2 -0 where its churn would read +9 -7. When the chain breaks (four
  edits to four distant functions), the header falls back to the summed
  churn, tooltip "lines touched". Never faked. The brief's strong guarantee
  (net always) would need harness-side pre/post snapshots; deliberately not
  built, recorded in J.
- **The expansion**: the net diff card when one exists, then one numbered
  child per call - its own verb, its own per-call count, its own diff card,
  its own harness sentence. A failed call is a child with the word "failed"
  in the danger colour and contributes to no aggregate. Collapse rules as
  briefed: a run still receiving (the segment's last file run, turn live) is
  open; closed runs collapse; the reader's toggle always wins and persists
  over both auto-states.
- **The entrance**: rows arriving with a live turn enter on a new `ENTER`
  preset - the house ease-out quint over the surface clock, a 6px rise with
  the fade - instead of the bare 0.18s opacity fade that read as an instant
  flash. Replayed rows play nothing.
- Tests: projection +6 (the run, transparency, the a-b-a rule, write joins,
  answer routing inside a merged run, seed parity), `groupNet.test.ts` +6
  (churn-vs-net, chaining, the broken chain, the skipped failure, the
  mid-run write, the nulls), ToolGroups +5 (net header, churn fallback and
  its label, the expansion, the failed child, the three-master collapse
  rule), RollingCount +1 (climbs from the standing number). Negative
  controls, each watched failing by name and restored: the run walk broken
  (6 projection tests fail), `netOf` nulled (4 unit + 2 component fail),
  the tick restarted from zero (the tick test fails). Old fixtures updated,
  their meaning unchanged.
- **Showcase**: the same conversation that drove the icon work -
  `cnv_5kdxm3nm` ("write a demo in twenty languages"), whose workspace at
  `~/.studio/data/conversations/cnv_5kdxm3nm/workspace` holds 41 snippet
  folders - exercises the run when its demo2.py is edited several times in
  one turn: one row, count ticking, net settling.

### O. The composer takes the clipboard and the drop

- A paste that carries files - a screenshot on the clipboard arrives as one
  - now becomes pending images through the same rules the file picker uses:
  judged, read, refused by name in the rejections line. A text-only paste
  never reaches the handler; the field stays a text field first. A file
  dragged onto the composer lands the same way, and a drag carrying no
  files is left to the field's default, which still inserts dragged words.
- Gated on the live transport exactly as the picker is: the demo turn
  carries only words, so there is nothing for a dropped file to ride on.
  Arbitrary non-image files still have no ride on the LIVE wire either -
  image attachments are the only attachment kind the harness carries - so
  the rules refuse them by name rather than pretending. General file
  attachments remain harness work, recorded in J.
- Files: `ComposerField.tsx` (the paste, as a prop - the field stays a
  dumb box), `Composer.tsx` (`ingestFiles`, the drop, the dragover
  acceptance). Tests +4: pasted screenshot joins the strip and touches no
  words, dropped image plus a refused csv, text-only paste untouched, the
  demo transport takes nothing. Negative control: the paste handler emptied
  by hand fails "turns a pasted screenshot" by name; restored.
- 721 -> 746 passing across 72 files; `tsc -b` clean; production build
  clean.

### P. Opening a conversation lands at the bottom

The report: switching conversations opened the transcript at the very top,
and a long conversation had to be scrolled down by hand to be continued.

- **The mechanism, mined end to end.** The shell keys each chat page by
  conversation id, so arriving in a conversation is a fresh mount: viewport
  at scrollTop 0, the follow pinned, the transcript empty. The replay then
  fills the projection a delivery at a time - and with more than 40 messages
  the paging window mounts its sentinel AT THE TOP of the document, where the
  fresh viewport is. The observer's first callback fires on the spot, an
  older batch prepends, and the correction that holds the reader still
  writes `scrollTop` from outside the follow engine - a write whose scroll
  event nothing guarded. Classified, it is "not upward, not at the bottom":
  unpinned. From that frame on, every delivery's effect reads `if (pinned)
  drive()` and does nothing. The teleport-to-bottom exists and was always
  armed; it only wins if its frame lands before the observer's first
  callback, a timing race the app lost. That is the whole mechanism of
  "opens at the top".
- **The fix: the open has a state of its own.** `useAutoScroll` now boards:
  from mount (and from a change of the conversation id, which the page now
  passes so a reused page re-arms too) until the chase arrives at real
  content, scroll events are attributed to the layout - the paging
  correction, a clamp after a content swap - and none of them may unpin.
  The chase keeps running on every delivery and every resize and lands the
  open at the bottom. Two doors out, both deliberate: the reader's own
  gesture - wheel, press, key - ends the boarding immediately and wins, the
  one thing this file will not do is yank someone who has already said where
  they want to be; and the boarding ends by itself the moment the chase
  arrives at a document with something in it, after which every scroll is
  classified exactly as before. A mount frame with nothing to scroll does
  not end it - the transcript has not come yet.
- Files: `useAutoScroll.ts` (the boarding, the arrival rule, the re-arm on
  `navigation`), `ChatPage.tsx` (one line: the id rides along). New suite
  `useAutoScroll.test.tsx` - the hook's first - 5 tests on a stubbed
  geometry and a manual frame clock: a tall transcript opens at the bottom;
  a paging correction during the open does not unpin and the chase still
  lands; a reader who wheels during the open is not yanked back; after
  arrival, classification resumes (a clamp unpins, as it always did); a
  reused page opens the next conversation at its bottom even after the
  reader had scrolled up in the previous one.
- Negative controls, each watched failing by name and restored: the
  boarding suppression removed fails "holds the pin through a paging
  correction made while it was still landing" - the reported bug reproduced
  in miniature; the navigation re-arm removed fails "opens the next
  conversation at its bottom when the page is reused".
- 746 -> 751 passing across 73 files; `tsc -b` clean; production build
  clean. Deliberately not taken: the same unpin theoretically exists for a
  collapse that shrinks the document while the reader is pinned below it -
  nothing reported, left for the day it is.

### Q. The open as a journey, the run told honestly, and what a fresh pair of eyes found

The report from the user, after trying the build: the open reached the
bottom but read as "the page, then a teleport"; single tool calls rendered
as groups; the run header's line count always showed zero; and the
jump-to-latest arrow sometimes vanished while the reader was nowhere near
the bottom.

- **The open, in two beats.** The first beat already existed - the shell's
  keyed surfaces crossfade conversation-to-conversation (the `sibling`
  preset, 0.18s) - but the second beat was a teleport: `followEngine`
  takes any distance over three screens instantly, which is right for a
  mid-stream reader and wrong for an arrival. The engine's `step` now takes
  options, and the open passes `teleport: false`: the whole boarding
  distance is a glide, the house exponential curve, fast at the start and
  settling as it lands - roughly 0.2s for a short transcript, around a
  second for a very long one, the same duration regardless of how far it
  flies. The streaming follow keeps its teleport; its behaviour is
  untouched.
- **The zero, explained.** `netOf` took a write's content as BOTH the file
  as found and the file as left - `diffLines(content, content)` - so every
  write-only run netted `+0 -0`, and since the header shows `net ?? churn`,
  the correct churn never showed. The user's twenty-language demo was all
  single writes; every row showed zero. The net's opening state is now
  provable exactly once: when the harness's own sentence says the file was
  created under the run's feet (`Created f.ts`), the file began empty, and
  the net is the file as the run's last call left it. `Replaced f.ts` says
  there was a file and nothing says what was in it - null, and the churn
  fallback says "lines touched" in the tooltip. A whole-file write landing
  mid-run ends an edit-opened reconstruction (no two provable states span
  it); the leftmost-occurrence anchor assumption is now stated in the
  docblock as load-bearing rather than hidden.
- **Singles are chips again.** A file row renders as a run only when two or
  more same-file mutating calls arrive together; a lone call is the plain
  chip it always was, with its own working state. The receiving scan stops
  at ANY file row - a single mutation to another file closes the run
  without handing the receiving flag to nobody's run (it used to leave the
  closed run stuck open and shimmering). A child of a run now anchors its
  diff on the harness echo exactly as the chip does - one fact, one
  rendering. And an empty write shows the empty diff card it claims
  (`+0 -0`, head only) instead of falling back to raw JSON: emptiness is a
  fact, not an absence.
- **The vanishing arrow, found.** The fresh-eye review (a read-only
  subagent over the whole scroll stack, the grouping and the echo
  anchoring, seven files plus their supports) found the mechanism: the
  jump's `scrollend` handler pinned the view WITHOUT checking where the
  flight had actually ended. A flight overtaken by growing content or
  aborted by a programmatic write fires `scrollend` far from the bottom -
  the arrow vanished there, and the follow then yanked the reader the rest
  of the way as if they had asked. `settle` now pins only on arrival. The
  same review caught that a press does not cancel a programmatic smooth
  scroll in Chromium (the flight kept moving after the reader stopped it,
  and its echoes re-pinned at the bottom): `release` now interrupts the
  flight at the reader's position. And it caught a dead safety mechanism -
  the flight belt, still commented out from an earlier negative control -
  which is re-armed, with the settle listener now revoked by gesture and
  navigation instead of leaking.
- **The code-text setting reaches the code.** The markdown fenced block and
  inline code already consumed `--code-size`; the diff cards under the tool
  chips - the code a reader watches most - pinned their bodies to the
  INTERFACE size (`text-ui`), so the appearance row could move every code
  surface but that one, and the raw input/output blocks hardcoded
  `text-[11px]`. All of them carry the `text-code` role now; the pane's
  hint names the diff cards.
- Tests: groupNet rewritten to the new net semantics (+7: the created-file
  net, the never-net-a-write-against-itself rule, the mid-run write ending
  the reconstruction, the chain, the refused anchor, the skipped failure,
  the nulls), ToolGroups +4 (singles stay chips, the run closed by a
  trailing single, the child anchored on the echo, the empty write's
  card), the scroll suite +2 and rewritten for the glide (a journey, not a
  jump; the paging correction held; no yank; classification resumes; the
  reused page opens at the bottom; the short scrollend pins nothing; the
  interrupted flight; the belt), FileDiff +1 (the body follows the
  code-text setting). Negative controls, each watched failing by name and
  restored: the singles gate, the write-as-both-states net, the boarding
  teleport, both flight un-sticks together, the unguarded settle, the
  old receiving scan, the child anchoring, the empty-string conflation,
  the flight interruption.
- 751 -> 761 passing across 73 files; `tsc -b` clean; production build
  clean. Observed and deliberately not changed: the windowing correction
  rebasing from a recorded position if the reader moves in the same
  instant a batch lands (pre-existing, unreproducible without a real
  gesture race); the one-commit-late first chase after a navigation switch
  (self-correcting); the chip-to-run shape change remounting the row
  (owned in a comment as the honest reading of it).

---

## 1. Files changed (formal task)

Not yet implemented. The brief's parts (dialog plugin both sides, the single
permission, `addFolder`'s real call, cancel means nothing) will be reported
here when the task lands.

---

## 2. Git

No commands that moved HEAD or the index across this whole stretch; no
commits, no stashes. All of the above is in the working tree. `Backend/`,
`documentation/` and `prompts/` were not touched; the only file written
outside code is this report.

---

## 3. Operational note: the restart after Q

At the user's request, after section Q's work was verified (761 tests, 73
files, `tsc -b` clean, production build clean), the running dev stack was
restarted the way `start.ps1` defines "start Studio": the whole tree rooted
at the script's own powershell - pnpm, `tauri dev`, vite (port 1420), the
cargo-built `studio.exe`, and the harness process the Tauri supervisor
owned - was stopped as one tree and verified gone (no orphaned harness
node, the port free), then `start.ps1` was launched detached in its own
window. The script checked the harness bundle against its sources (no
harness source had changed; no rebuild was needed), started the dev app,
and the supervisor spawned the harness. Verified back up: vite listening
on 1420, `studio.exe` running, and the harness (`STUDIO HARNESS/dist/
server.mjs`) alive as the app's own child. The user's Tauri window is the
verification surface for everything in sections P and Q.

---

## R. Design: background execution and the wake (chosen path, not yet built)

The question: is a background task a new primitive, and how does the model
get pinged when it finishes? Researched against both reference harnesses.
Claude Code keeps the regular shell tool and adds a `run_in_background`
flag; output goes to a retrievable file; on exit the harness injects a
`<task-notification>` message into the conversation, which re-invokes the
agent from idle (their issue #39027 records the sharp edge: notifications
fire autonomous API calls). Codex's beta `unified_exec` runs long-lived
terminal sessions with stable ids, write/read/wait across turns, and has
been patched twice for the two failure modes - sessions torn down at turn
end (#10767), and turns refusing to complete while a process runs (#14731).

The chosen path, in stages:

1. `shell` grows `background: true` and `notify: true|false` (the model
   decides per task; notify defaults true). Same command line, same
   interpreter, same sandbox grant - nothing new to approve. A task
   registry holds id, command, status, and an output ring buffer per
   conversation; a small `task` tool reads status/output and stops. Tasks
   die with the harness and are capped per conversation.
2. The wake is NOT a task feature - it is one admission pathway with
   pluggable sources. Source one is task completion: the harness mints a
   SYSTEM submission through the same admission-receipt shape, so the
   existing read/attach/stream machinery carries it; a chunk field marks
   the turn system-initiated, and the UI renders it honestly (a turn the
   reader did not type). Because turns are log-based (ADR 0045), a wake
   that fires while the window is closed replays on attach - the ping is
   durable, which neither reference harness can claim.
3. Guardrails from the research: cap concurrent wakes per conversation and
   bound wake chains (a notification turn that starts tasks must not wake
   forever); one visible kill switch; the phase machine untouched (a wake
   is a real run and the working marks light honestly).
4. Later sources on the same pathway: schedules (cron), file watchers.
   Deliberately NOT built: a generic condition engine.

## S. The grouping rework: two screenshots, one rule

The user's first screenshot showed four consecutive same-file edits
narrated between ("Edit 1 of 4 ...") rendering as four chips - grouping
never fired, because the projection opened a fresh tools segment whenever
text fell between calls, and the run walk was segment-scoped. The first
fix went too far the other way: every tool call in a message routed into
ONE tools segment, so a real turn (17 edits to index.html spread across
searches, reads, and thirty reasoning runs) collapsed into a single
17-edit capsule at the top of the message with the reads and the thinking
walled after it - chronology destroyed, which the user caught on the second
screenshot and named plainly: fix it properly or remove the mechanism.

The rebuilt rule - a run is a LOCAL event, and chronology wins:

- A mutating call continues the message's open run across written
  narration only: the words render after the row they describe.
- A read of the run's own file keeps the run open (the verify-then-fix
  loop is one act; its row stands between the calls).
- Thinking closes the run: work the model went away and did, and the
  events either side of it happened apart. Reasoning rows keep their
  chronological place; no more thinking wall.
- Any other tool (search, glob, bash) and any read of another file close
  the run. A different-file mutation closes it (a, b, a stays three rows).
- Mechanically: the projection now carries `openFileRuns` - per message,
  the home segment, row, and file of the still-open run. A continuing call
  merges at that home, wherever narration has pushed it; everything else
  opens a row at the true end of the story. `pushCall` lost its backward
  scan (the memory knows where home is); the seed walk mirrors the live
  walk rule for rule, and `seededProjection` derives open runs from the
  built shape so a live call continuing after a cold start merges into
  history's row.

Tests: +5 (narration merges live and replayed; thinking breaks, with
chronological segments; a search breaks; a read of another file breaks)
on top of the existing run rules, all still green. Negative controls,
each watched failing by name and restored: the thinking break removed,
the search break removed, the open-run merge removed.

Diagnosed this session, then fixed:

- **The thinking timer's stall-then-jump.** The clock was always honest --
  `Date.now()` read at render -- but a number can only change on a paint,
  and every streamed delta re-rendered every row in the window, starving
  the one-second tick among them: 1, 2, 3, 4, silence, 7. Every transcript
  row is `React.memo`'d now (both live paths and the gallery's), and the
  two row callbacks hold identity stable -- the branch through a
  latest-ref, the fork through `useCallback` -- so a delta re-renders only
  the row it landed on. Pinned by a boundary test: a sibling's item
  changing commits nothing on an unchanged row (watched by a memoized
  counter with stable marks; the negative control removes the memo chain
  and watches the neighbour commit).
- **The sidebar toggle's midway lag.** The panel springs its WIDTH, so the
  page re-lays-out every frame of the move, and the transcript is the
  heaviest thing in it -- peak spring velocity is peak reflow cost, which
  is why it went smooth, laggy, smooth. For the length of the spring only
  (AppShell holds a class fed by the sidebar's own animation callbacks),
  every message row steps out of layout with `content-visibility: auto`
  and a remembered intrinsic size; when the spring lands the class leaves
  and everything lays out for real. Scoped to the move deliberately: an
  always-on rule would hand the paging window estimated heights for rows
  nobody has rendered, and the hold-still correction there measures real
  heights. This one is CSS on a moving page -- jsdom cannot measure
  layout, so it is untested by unit and verified by the reader's eye.

- 761 -> 766 passing across 73 files; `tsc -b` clean; production build
  clean. (767 after the memo boundary test landed with the work above;
  final gate for this section: 767 / 73, `tsc -b` clean, build clean.)
