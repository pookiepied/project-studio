# Family A, phase 2: checklist

The record of this phase: what is done, in progress and left. Tasks run one at a
time, small to large, and a task is only ticked once it has been tested. The
numbers are the brief's. Family B references guide settings and appearance; the
current app stays the foundation.

Status: `[ ]` left, `[~]` in progress, `[x]` done.

## Order

1. [x] **8. Jump to Latest.** Only when the reader has scrolled away. Selecting
   text must not trigger it, move it or scroll. Consistent while reading,
   selecting and streaming.
2. [x] **6. Streaming cursor.** Follows the end of the streaming text, not the
   bottom of the block. Not inside tables, charts and other structured content.
   Accent colour, checked in both themes.
3. [x] **9. Right-click menu.** Remove the global app verbs; keep only what fits
   where the click landed; compact if it stays at all.
4. [x] **10. Text selection menus.** Review Cut/Copy/Paste/Select all and
   Copy/Select all/Ask about this. Remove duplication without breaking editing
   or shortcuts.
5. [x] **11. Response selection toolbar.** Small horizontal Copy and Reply, near
   the selection, on select and on right-click.
6. [x] **7. Language, file and path visuals.** Languages, files, folders, paths,
   images, `.exe`, `.md` and other types: icons, consistent size and spacing.
7. [x] **2. Settings layout.** Evaluate removing or redesigning the settings
   sidebar, recommend, implement. Family B is the primary reference.
8. [x] **3. Appearance settings.** Theme, typography, font size as a minus/plus
   counter, organised to the reference.
9. [x] **4. UI scaling.** New percentage setting that scales the whole interface
   through the styling system. Separate from font size.
10. [x] **5. Dictation.** Empty, recording, text arriving and text present states,
    with smooth transitions, matching the app.
11. [x] **1. Sidebar.** Width, spacing, icons, project-based organisation.
12. [x] **12. Composer formatting toolbar.** Investigate feasibility, recommend,
    build only if it earns its place.
13. [x] **13. Consistency pass.** Accent, type, icons, spacing, radii, motion, both
    themes, scaling. Ends with the full client check.

## Decisions

Technical decisions and recommendations are recorded here as each task reaches
them.

- **Task 8.** A press stops the follow but no longer counts as leaving. The pin
  returns once the press ends with no selection left and the view at the bottom.
  The arrow answers to `distant`, not to "not following". While a stream grows
  under a held selection the arrow does appear, because the reader really is
  away from the latest text then.
- **Task 6.** The caret moved from after the rendered block into the markdown
  tree (`rehypeCaret`), beside the last word. Tables, code, charts, pictures and
  rules get no caret. Tested in unit tests; not yet watched on a live stream,
  because that means sending a real message.
- **Tasks 9, 10, 11.** One contextual surface now: a small horizontal toolbar
  (`FloatingMenu`, `ActionItems`). A right-click does something only where there
  is something to act on: Cut, Copy, Paste in a text field; Copy on a selection
  outside a transcript. Anywhere else it does nothing. Selected transcript text
  raises Copy and Reply as the pointer rises, and a right-click on it leaves that
  toolbar up. The app verbs that used to sit in the right-click menu live in the
  header and Ctrl K, and Reload moved to Ctrl K because Ctrl R and F5 are blocked.
  Select all stays on Ctrl A. Ask about this is gone: Reply does that job. Checked
  in the running app in dark; light and the exit animation were not looked at
  again after the toolbar rebuild.
- **Task 7.** Marks stop being grey. Every file kind takes one of eight shared
  tones (`--tone-*`, tuned per theme) rather than its brand colour, and plain
  text and unknown kinds stay neutral. Added marks for programs (`.exe`, `.msi`,
  `.bat`, `.dll`), archives, PDFs, audio, video, text, sheets, documents and
  secrets (`.env`, `.pem`). A path reference now shows a folder mark when it reads
  as a directory; that is a best reading for the glyph only (`namesFolder`) and
  reveal never consults it. The inline chip wears a wash of its own tone. Code
  block headers carry the language in the same tone, at one icon size. Inline
  `python` in prose gets no mark: bare words like `go` or `c` are too ambiguous.
  Tones and chips were checked in both themes on a static render of the real
  stylesheets with stand-in glyphs, not in a live reply.
- **Task 2.** Kept a section list and moved it into the Settings page, as Family B
  does, instead of removing it. Twenty-odd sections in one scroll is a worse way
  to find anything, and the old list lived in the sidebar column, which is a
  hidden drawer at the default window size. The sidebar now keeps conversations
  on every route, and Back sits at the top of the list. Where the page is too
  narrow for two columns the list becomes a scrolling row, by container query, so
  high UI scales get it for free. Checked in the running app at the default size.
- **Tasks 3 and 4.** Theme and typeface cards, a preview, `Stepper` counters for
  text, code and UI scale, and sections to the reference. Typeface sets replies
  only; the interface stays in Inter. UI scale (90 to 200%) uses the webview's own
  zoom (`setInterfaceZoom`), so every pixel and the viewport scale with no scaled
  values kept; it needed `core:webview:allow-set-webview-zoom`. Indicator, overlay
  and browser windows stay at 100%. Seen working in the app from 100 to 200%, and
  in a detached conversation window at 125%.
  A step rescales the page and moves the counter's own buttons (about 155px from
  200 to 175%), so a second click at the same spot missed. The number now answers
  at once and the rescale waits 600ms for the clicking to stop. Space steps it too;
  the earlier failure was the same missed click, so the button never had focus.
- **Window size across launches.** The window-state plugin writes only on a clean
  exit, which rarely happens: close-to-tray is on by default, so X only hides the
  window, and closing the `start.bat` console ends the process. Studio therefore
  reopened at an old size, and the size reset did not last.
  `window::remember_placement` now writes size and position 600ms after a window
  stops moving. Checked with a hard kill and a relaunch through `start.ps1`.
- **Compact and Standard window sizes.** Two presets in Appearance replace "Reset
  to default size": Compact is 776x901 and the default, Standard is 1040x720 and
  opens the sidebar, and Compact closes it. They are sizes, not modes, so there is no stored mode
  and no second layout: `applyWindowSize` only resizes and centres the window,
  and layout follows width as at any dragged size. A window relaunched at Standard
  starts with the sidebar closed, because sidebar state is not remembered.

- **Task 5, dictation.** The red reference is the bottom row of reference 3: a
  red dot, a clock, Cancel, Pause and a confirm button. Adapted, not copied: the
  tools row becomes Cancel, then the dot, clock and a short real level meter, then
  Pause and the accent confirm. The field's slot prompts "Go ahead, I'm listening"
  until words return. Those words show in the real field, read-only, after any
  draft, so they wrap, grow the box and scroll as typed text does. An overlay of a
  fixed height clipped the second line. The draft itself is only written when the
  take ends, so Cancel has nothing to undo, and words already on screen do not play
  the landing again. Pause is
  real: `MediaRecorder.pause`, with the silence cutter held, because a cut during a
  pause would start a recorder that is not paused. Checked with the real microphone.
- **Task 1, sidebar.** 256px, one row height, one mark per row at rest. Projects
  keep the mark the person chose rather than a folder, so the disclosure moved to
  the far end. Conversations align under the project name, labels are sentence
  case, an open project page highlights its row, a project shows five conversations
  and then "Show N more", and an empty list offers "Add a project". The rounded edge
  stays. Project rows checked on a sample render in both themes, because this
  install has no projects; the empty state checked in the app.
- **Task 12, composer formatting: not built.** The composer is a plain `textarea`,
  so a toolbar means one of two things. Inserting Markdown leaves raw `**` in the
  field and needs a measured popover over a textarea, for formatting a model mostly
  does not need. A real editor (Lexical, TipTap) replaces the field and has to
  re-prove drafts, slash commands, paste, dictation landing, Improve and height
  animation. Neither earns its place today. `Ctrl B` and `Ctrl K` are also taken by
  the sidebar and palette. Worth revisiting only if messages become documents.

## After the phase

- **Typeface reaches the whole window.** It only ever set `.studio-prose`, so on
  Settings and everywhere else it looked like it did nothing. It now sets
  `--font-interface`, read once on `html`. Code stays monospaced.
- **Window size uses the same cards as theme and typeface.** The chosen card comes
  from the real window, so a dragged or maximized window shows neither.
- **Settings' side panel lists groups.** It shows the seven groups with the open
  group's pages beneath, so it no longer needs all 23 rows at once. What stays, what
  is a placeholder and what to build later is in `settings-plan.md`.
- **Conversation rows show a status.** A thin ring of ticks for working, a blue dot for
  waiting on a permission or question, a check for finished while you were away.
  They appear in the header's list and the sidebar, and a small dot on the history
  icon says another conversation wants you. Working and waiting come from the
  harness (new `GET /api/conversations/running`, plus the two pending lists), because
  a page stops reporting when it closes. Finished is noticed in the window, clears
  on opening, and survives a reload. Coming back to a hidden window reads at once.
  Notifications are not built.
- **A paused window no longer calls a run broken.** Both 45-second read limits gave
  up after a hidden window or a sleeping machine, because the pause looked like the
  harness going silent. The webview's limit now restarts when the page was hidden or
  its timer fired late, and the native one restarts when its own loop was stopped.

- **Default text size stays 15px.** At the 776px Compact width a reply runs about 85
  characters a line, the top of what reads comfortably, and 16px would cost a line
  in every paragraph for little gain. 15 also keeps the reference's proportions,
  and the Appearance counter covers anyone who wants more.
- **Files a reply mentions are their own subsystem.** `features/files` replaces the
  chip's copy panel and its folder button. A click opens one small menu, and the
  rows come from the file's kind: Preview, Open, Open in VS Code, Show in folder,
  Copy path. "Folder unknown" is gone. It meant the client had no idea where a
  conversation without a project stands, because only the harness knows.
  - *Finding the path.* The harness answers (`conversations/files.ts`): an exact
    reading first, then a bounded search of the conversation's own folders for a
    path ending the same way, newest first, saying if others fit. The client's own
    guess at the root folder is deleted. Only a click asks, so a transcript of paths
    reads nothing from disk. A full Windows path outside those folders stays usable
    by its own words, without a preview.
  - *Opening.* The chip's old rule was that nothing launches, and a path comes from
    a model, so opening is limited in the native host (`open_file.rs`), not the
    menu. Windows associations get a fixed list of inert types only, because `.js`,
    `.vbs` and `.py` run on double click. Editors get anything, since an editor does
    not run a script, and start directly rather than through `code.cmd`, which
    re-parses its arguments.
  - *Viewing.* The side rail is the viewer: it already overlays at Compact, so it
    costs no room. Markdown, text, code and pictures show there. Video, audio, PDF
    and Office files go to their own app. `.env` and key files are never sent to
    the viewer, though an editor can still open them.

- **A chosen row shows its status.** The check gave way to nothing, so the open
  conversation hid that it was working. The row's own mark now wins, and the blue
  fill alone says which row is chosen; the check returns when there is no status.
- **The file menu shows verbs, not a path.** The full path is gone, because Preview
  and the open rows already say what matters; Copy path still gives it. Editors
  show their own filled logos, from Simple Icons' single-colour paths, set lighter:
  90% of the box with the fill at 70%, inside the icon's normal edge. Full size and
  full ink outweighed the line marks beside them, and outlines read too thin.
  The menu carries the file's name as its label and groups its rows as look at
  it, work on it and find it, matching the app's other menus.
  Write's mark is a quill: the page with a corner plus read as an insect at 14px,
  and the pencil already means Edit.
- **Floating panels have a visible arrival and exit.** The old entry was finished
  by the third frame, and the old exit held at full opacity and then dropped, so
  neither read as motion. Panels now grow from 94% out of the corner nearest their
  trigger over 260ms and fade out across 180ms. This is the shared `floatingMotion`,
  so every popover changed with it, as the motion rule asks. The file menu also
  animates its height when its rows arrive.
- **Activity titles stay on one line.** The title shows the running command, and it
  wrapped to three lines on a long one. It now truncates, with the whole text on
  hover, like the rows beneath it.
- **A compaction stays where it happened.** After a stopped turn the record follows
  the abort advisory, a system message the transcript never draws, so the marker
  found no anchor and went to the very top. It now walks back to the nearest drawn
  message. The row reads only "Context compacted", with no token count. A compaction that fires during a turn
  still appears only on the next read, because the stream has no chunk for it.
- **An open tool group has one rhythm.** Thought rows carried a 10px bottom margin
  and tool groups 4px top and bottom, so the gap ran from about 8 to 18px depending
  on which row came first. Rows now carry no outer margin and the list sets 8px
  between any two, and from the title to the first row. Codex's rows sit about 5px
  apart, which reads as cramped at our type size. The gaps around an answer stay.
- **Floating menus have even sides.** `scrollbar-gutter: stable` reserved an empty
  track on the right of every menu list, so pills sat about 4px off centre. Menus
  now use `studio-scroll-menu`, which shows no bar: rows still do not jump, and the
  wheel and keys still scroll. Dialogs and result panels keep a visible bar.

## Checks

Each task runs the type check and the tests for what it touched. The full client
check runs at the end of the phase, not per task.

End of phase, 2026-11-07: `pnpm -C STUDIO check` passed, 232 files and 1956 tests.
`cargo test --lib` passes, 173 with 2 ignored, with Studio open: the supervisor
tests now run the Harness in a temporary home rather than `~/.studio`.

## Tooltips and spelling

- **Native tooltips on tool rows.** Truncated labels in the transcript (activity titles, search and file rows, diff paths, web results, attachments) used `title=`, which draws the webview's unstyled tooltip. They now use the app's `Tooltip`, which gained `overflowOnly` (speaks only when the text is actually cut off) and `className` (so a truncating child can still shrink in a row). About 17 `title=` uses remain in settings, sidebar and rail files, left for those areas.
- **Spelling suggestions in the text-field menu.** The webview's own menu, which carried them, is blocked, so the field menu now offers up to three corrections for the word under the caret or selected. Decision: a bundled English Hunspell dictionary via `nspell` (`src/assets/spelling`, lazy-loaded on first right-click, about 0.5 MB) rather than a native Windows spell-check call, to keep it cross-platform and add no native boundary. Limits: English only, no personal dictionary, and code-like words (camelCase, paths, digits, acronyms) are skipped.

## Question and permission cards

- **One shell, redrawn after the reference's suggestion panel.** `CardShell` is now
  a 24px-radius card at the composer's width (`.studio-prompt-card`), white in
  light and frosted `#363636` at 82% under a hairline in dark. A quiet hint row
  names the kind of question with key chips for "to navigate" and "to select",
  then the sentence, then the answers as borderless rows that start with an
  accent arrow (`Icons.choose`). One row is lit in the accent wash; the arrow keys
  move it, wrap, and focus the row, so Enter answers with it.
- **No Escape.** The reference's panel closes on Escape. This card does not, and
  its hint row does not offer it: dismissing a permission must never read as a
  no, and a question already has "You decide" and "Stop".
- **Questions.** A–D letters are gone. Single-answer rows use the arrow,
  multi-answer rows a ring that fills with a check. The recommended option is lit
  on arrival but not chosen. "Something else" keeps its inline field. You decide
  and Stop are quiet ghost buttons; Submit appears only when a click has nothing
  else to commit.
- **Permissions become rows.** The duration switch and the Allow and Deny pills
  are now one list: Allow once, Allow for this conversation, Always allow in this
  project, Deny, each saying what it stores. Allow once is lit first, so Enter
  still gives the narrowest grant. The verdict, duration and folder scope sent to
  the harness are unchanged. Two things did change: a wider grant is one click
  rather than choosing a duration and then Allow, and Deny is always answered
  once, so a lasting deny is no longer offered from the card.
- Checked on the dev showcase (`showcase.html`, new "Questions and permissions"
  section) in light and dark at 760px, including arrow-key movement. Not yet seen
  with a real run stopping in the app.
- **Second pass, closer to the reference.** Each answer is one line: arrow and
  label, with a neutral highlight (`--soft`, not the accent wash) that hugs the
  words rather than spanning the card. Descriptions moved into one line beneath the
  rows, showing the lit row's description. Pointing at a row or arriving on it with
  the arrows lights it, so a permission's consequence is still read before the
  click, and rows never shift under the pointer. The hint row leads with ▲ ▼ and ↩
  chips; the kind of question sits at its right. "Something else" is the field
  itself. The surface is translucent in both themes (white at 76%, `#383838` at
  72%) with a 28px blur and a hairline.
- **Quote strip overflow.** The `Tooltip` wrapper is `inline-flex`, so it grew to
  the passage's full width and the line never truncated: it ran under the cross.
  The wrapper now fills the column (`flex w-full min-w-0`), and the tooltip only
  shows when the line is cut off. Checked on the showcase with a long passage.

### Third pass: the card takes the composer's place

- **What the old buttons did.** "You decide" settled the question as `deferred`,
  but the model only ever saw a bare `outcome: "deferred"` with no instruction, and
  the harness replies to the model only once every question in the call is settled,
  so on question 1 of 3 it looked like nothing happened. "Stop" settled the
  questions as stopped and armed a closing turn: the model still wrote one more
  message, so the run did not stop.
- **Decided ways out (minimal).** Pick an answer, write one, Skip, or stop. Skip
  sends the old deferral, and the harness now adds a `note` to the tool result
  telling the model the person skipped and it should choose, say which, and carry
  on (`tools/ask/questions.ts`). Stop is the composer's own stop
  (`stopWithComputerCleanup`): the run is aborted and its questions withdrawn. The
  closing-turn path stays for other callers but the card no longer uses it. The
  transcript now reads "Skipped" for a deferred answer.
- **The card replaces the composer** while a permission or question waits (your
  choice). `PromptFrame` opens from the composer's measured height, eases its height
  with a spring as questions change, and crossfades the content. The composer
  returns when the run moves on; its draft survives through the drafts store.
  Queueing a follow-up while a question waits is no longer possible, by design.
- **The foot is the composer in miniature.** A field that grows with the answer and
  scrolls past eight lines (`field-sizing: content`), Shift Enter for a new line,
  dictation through the composer's own `useDictation` and `DictationControls`, and
  one round button: stop while empty, send once written (or once choices are ticked
  on a multi-answer question). Typing anywhere lands in the field. The separate
  "Something else" row and the Submit button are gone.
- **Permissions** keep their four rows; the stop sits at the end of the description
  line so it costs no row.
- **Height.** The description slot is a fixed two lines, so pointing along rows
  never resizes the card; only a new question does, and that eases.
- **Position.** "2 of 3" in the hint row while a call asks several, counted from
  every question seen while the card stood.
- **Ask icon.** The bubble-with-question became a plain circled question mark
  (`HelpCircleIcon`) wherever ask appears; the card's hint row has no mark at all.
- Checked on the showcase in light and dark: stepping through a three-question call
  (single, multi, four options with a deadline), the field growing to its cap, the
  stop/send swap. The pane was hidden, so the height easing itself was not watched
  frame by frame; end heights match the content. Not yet seen with a real run.

### Fourth pass: polish, answers in the transcript, and composer cleanups

- **Row highlight: one column (your choice).** The answer rows share the width of
  the longest answer (at least 12rem, at most the card), so every highlight is the
  same width: neither the whole card nor a ragged wash per word.
- **Skip is a tag.** A small uppercase `SKIP` chip in the foreground
  (`studio-prompt-tag`), so the one control in the hint row is found at a glance.
- **Checkbox tick.** The tick was painting at 16.5px inside a 15px ring: the mark's
  box is an inline width, so the size class on it never applied. It is now 9px,
  set by `style`.
- **Ask icon.** You hadn't decided; I chose the bare question mark (`QuestionIcon`)
  with no circle, matching the transcript's other open line marks. The chat bubble
  with a question (`MessageQuestionIcon`) is the alternative if this reads too plain.
- **Answers stand in the transcript.** A question call no longer has a row inside
  the activity block (where its answers sat behind two disclosures). It is a
  standalone slot (`toolPresentation` `artifact: 'answers'`, `QuestionAnswers`): each
  question in the quiet voice, the answer in the foreground behind the card's arrow,
  written answers whole with their line breaks, "Skipped, left to the agent" for a
  skip. Nothing shows while the card is still waiting.
- **Dictation silence is not a failure.** `useDictation` watches the mic's voiced
  frames. A take that never heard a voice ends with "No speech heard", and one that
  heard a voice but got no words back ends with "Didn't catch that - try again".
  Both are plain muted lines, shown for 1.8s, with no "Dictation failed" label. A
  provider refusing a silent clip is read as silence too. A real refusal after
  speech still shows the failure as before.
- **Unavailable dictation in the three dots.** The row stays "Dictate", greyed, with
  "Not available" at its end; the reason (needs HTTPS) is the hover tooltip and the
  accessible name, not the row's text.
- **Paperclip opens files directly.** The add-context menu (Files, Set a goal, Plan
  first, Extensions) had one live row. `AddMenu.tsx` is deleted, along with the
  `goal` and `attach` registry entries that only it used; the paperclip is now
  "Attach files" and opens the picker. The 2026-09-03 audit still names `AddMenu`; it
  is a historical record and is left as written.
- **Slash list.** It now wears the question card's glass (`studio-slash-panel`), opens
  with the same key hints plus "esc to dismiss", sets command names in the body face
  instead of monospace, and uses the card's neutral wash for the picked row.
- **Compaction jump.** The compacting flag clears when the harness answers, but the
  record line arrives only after the page reattaches, so the wait line collapsed and
  then the record appeared: two jumps. `useCompactionHandover` holds the wait line
  until the log has one more compaction record, then leaves it out of the render the
  record arrives in (no exit frame), at the same height (the wait line lost its extra
  `py-0.5`). A refused compaction's line folds away after 2.5s.
- **Not done here, noted for later:** where warnings appear (for example `/compact`'s
  "already compacted" note showing in the field) needs one consistent home; you asked
  to discuss that separately.
- Checked: client typecheck clean, lint clean on the touched areas, 966 tests across
  108 files in chat, voice and components. On the showcase: equal row widths, the
  SKIP tag, the 9px tick in its ring, and the answered record. Not seen live: the
  slash list, the compaction handover and the silent-take line in a real run.

### Fix after a real run: the answer record was missing

- **What happened.** In a real conversation no answers showed and each "Thought for"
  line sat flush against the paragraph above it. The ask tool returns an object, but
  the harness serialises tool results to text for the model, and Flue's projection
  hands the client that lone text block as the call's output: a JSON string.
  `QuestionAnswers` read only objects, so it rendered nothing. The question call had
  also left the activity block, which left the thought before it standing alone; a
  thought on its own never took the margin a tool row takes against words.
- **Fix.** `QuestionAnswers` reads the output as an object or as JSON text, and if the
  output is present but unreadable it still shows the questions, each marked
  "Answered". The record and a lone thought both take a tool row's margins against
  words. Tests cover the string output and the unreadable case.
- **Open:** once a turn settles into its work summary, standalone records from the
  summarised part (generated media, and now answers) are lifted to the top of the
  turn. Not yet seen with answers in a real run.

### The answer record becomes one row (your choice)

- The record is now a single disclosure row in the tool rows' shape: the ask mark,
  then the answers read at a glance ("Answered · Email · Rust, TypeScript · 1
  skipped"; a written answer cut at its first line; "Skipped 2 questions" when
  nothing was answered). It opens onto each question with its full answer.
- It stays a standalone slot, outside the activity block, so it remains visible when
  a settled turn folds its work into "Worked for…". Correction to the note above:
  standalone records from the folded part sit directly below that summary line and
  above the final text, not at the top of the turn, which is where this row belongs.
- It takes a tool row's margin next to words, and the house entrance while live.
- **Ask mark, again.** Hugeicons' `QuestionIcon` turned out to be a figure with a
  speech bubble, not a question mark. The mark is now drawn (`AskMark` in
  `drawn.tsx`): one stroke and a dot on the 16-unit grid.
- Checked: typecheck, lint, transcript, card and icon tests; the row at rest and open
  on the showcase. Not yet seen in a real run.

## Skips, and the opened answer row (after a real run)

- **A skipped question was asked again.** In a real run (GLM 5.3 Flash) the model
  re-asked the one question the person skipped. The tool already returned a shared
  `note`, but each skipped entry still read `"outcome": "deferred"` with no answer, so
  a model reading the entry saw an unanswered question. Each skipped entry now carries
  `answer: "skip"`, the note ends "Do not ask a skipped question again", and the tool
  description says a question answered "skip" is the model's to decide. The client
  ignores the new field. Harness test: `questions.test.ts`.
- **The opened row ran into the next one.** The answer body was drawn `flush` (no
  rule), so its questions read as rows of their own and the next row ("Thought for
  2s") looked like one more answer. It now hangs behind the rule like every other
  opened row, with a little air below.
- At rest the answer row and a following thought sit as adjacent rows with no extra
  gap, the same rhythm a tool group's rows have. Left as is.

## No rule under opened rows; thinking opens in place

- **The rule is gone again.** Putting the answer body behind the left rule fixed the
  run-on, but drew a divider the page didn't otherwise have. `DisclosureRow` now has a
  `hang` body: no rule, indented by exactly the mark and its gap (`1.1em + 6px` of the
  caption), so the body's first letter lines up with the label's, and a breath
  (`mb-2.5`) below ends it before the next row. The answer row uses it.
- **Thinking no longer opens a dialog.** The "Reasoning" modal is gone. The thinking
  row is a `DisclosureRow` with `hang`: pressing it opens the trace in place, in a
  window capped at `max-h-48` that scrolls on its own, so a long trace is a few lines
  to read and one stride to scroll past. Opened mid-run it starts at the newest line
  and follows until the reader scrolls up, as the sheet did.
- Checked: typecheck, lint, transcript tests (504), the answer row open on the
  showcase. The thinking window has no showcase specimen; it is not yet seen in a run.

## One gap between loose rows; a quieter trace

- **Uneven gaps between ungrouped rows.** A thought standing alone kept `mb-2.5`
  while the answer row beside it kept no margin, so "Thought → Question" stood apart
  and "Question → Thought" sat tight. No row now carries an outer margin for a row
  neighbour. The row below another row takes `mt-2` (`rowGap.ts`), the same 8px an
  opened activity block uses between its rows (`gap-2`, now from the same file).
  Words above or below keep the larger `mt-4` / `mb-4`. `AssistantTurn` decides with
  `isRow`: thoughts, activity rows and the answer row count; text and media cards don't.
  A `hang` body's own breath dropped to `mb-1`, since the row gap now follows it.
- **The opened trace read like more rows.** At the rows' grey and caption leading,
  a long thought's lines looked like tool labels. The trace is now at 70% opacity on
  looser leading (`leading-relaxed`), so it reads as a note under its row.
- Checked: typecheck, lint, transcript tests. Not yet seen in a real run.

## Generated images and video, for Family A

Agreed from a layout demo first, then built on the real components and checked in the
showcase at the 720px window, dark.

- **No card.** `MediaArtifact` no longer sits in `ArtifactShell`. It is one row in the
  shape of every other turn row (`DisclosureRow`, `hang`): the medium's mark, then
  "Generating image · model" (shimmering), "Image · model", "4 images · model",
  "Video · model". Opening the row shows the prompt, or the title when the prompt is
  the title (the transcript names a call by its prompt). The title stays the picture's
  accessible name and the lightbox title.
- **Frames are the picture's shape, under one height** (`MEDIA_FRAME`, `MediaGrid`):
  a picture alone is at most 300px tall (16:9 → 533×300, 9:16 → 169×300); two share a
  240px row; three or four split 300px into two rows (147px squares). A row too wide
  for the column shrinks every frame by the same factor. Corners 18px alone, 14px in a
  set. This replaced full-measure rows under a 480px cap, with tall pictures centred
  over a blurred copy.
- **Waiting** is the whole frame breathing (`animate-pulse` on a faint field, still
  under reduced motion), not three small dots in a grey box.
- **Hover**: the keep button sits in the top corner as a dark round button and appears
  with the pointer or keyboard focus; clicking the picture still opens it. There is no
  download button: Studio has no save path for a generated file yet, and adding one is
  a new native boundary (observability contract), so it is left for its own change.
- **Endings**: a failure is the row in the danger colour with the harness's sentence,
  and no frames. A stop is the row in grey, with its own reason when it carries one
  ("…so its result was not kept").
- **Holder option.** `held` draws the same row and frames inside a 20px rounded sunken
  holder, the earlier look. The showcase has a "No holder / Holder" switch to compare.
- Checked: typecheck, lint, 816 chat/rail/showcase tests and the artifact tests;
  every stage in the showcase at 720px dark; hover at 800px (under 768px the browser
  pane emulates a touch device, which turns hover off). Not yet seen in a real run.

## Closing rows, the media row, the wait and the viewer

- **Rows that close at the end of the page.** Closing any opened row (thinking,
  answers, a tool group, a media prompt) near the bottom shrank the page, the browser
  clamped the scroll, and everything jumped down before the collapse finished. Now
  `useAutoScroll` keeps a spacer after the content: for `COLLAPSE_HOLD_MS` after a
  click, a shrink is given back in the spacer before paint, so the reader stays put;
  scrolling up trims the spacer again, and navigation resets it. One fix for every row.
- **No model on the media row.** The row reads "Generating image", "Image",
  "2 images", "Video". The model is named in the viewer instead.
- **Waiting** is a faint dot grid with a brighter band sweeping across
  (`.studio-media-wait`), still under reduced motion. No percentage: no vendor
  reports progress, and a made-up figure is worse than none.
- **Viewer.** No raised panel and no inset frame: the picture fills the window over
  the scrim with its own 18px corner. Small dark pills float over the top: the model
  on the left, Keep (images, when the caller can file) and Close on the right. The
  prompt is one quiet line under the picture. Clicking outside the picture closes it.
- **Not built here:** download (needs a native save boundary under the observability
  contract), and the editing tools (markup, comment, remove background, erase,
  resize). Each is its own feature.
- Checked: typecheck, lint, 509 transcript/artifact/showcase tests; the wait and the
  viewer in the showcase. Not yet seen in a real run.

## Editing a generated picture from the viewer

- **An edit is a message, as in Codex.** Under the picture: Remove background, Ratio
  (1:1, 4:3, 3:4, 16:9, 9:16), Erase, Edit area. Each sends an ordinary message with
  the picture attached and a fixed sentence (`media/edits.ts`, `EDIT_PROMPTS`), then
  the viewer closes. The model hands the attachment to `studio_image` as an input
  image; every image vendor already edits from input images. No harness change: the
  attachments folder is already a read root named to the model, and the send goes
  through `sendTurn`, queued behind a running turn like a typed message.
- **Erase and Edit area send a mask.** A brush paints over the picture
  (`MaskCanvas`, strokes kept in the picture's own pixels); on send the strokes go
  as a second image, white where painted, black elsewhere, at the picture's natural
  size. "Remove the area marked in the second image from the first image". Edit area
  adds the person's words. The original is never painted on.
- **Where it shows.** Images only, where `MediaEditContext` is provided (the chat
  page; the showcase with a send that is dropped). A picture the submission would
  refuse (not base64 PNG/JPEG/WebP/GIF, or over the per-turn byte cap) says so and
  sends nothing. A refused send keeps the viewer open with a note.
- **Not here:** download (native save boundary) and progress for OpenAI's partial
  images.
- Checked: typecheck, lint, 813 chat/artifact/showcase tests including the new viewer
  tests; toolbar and brush in the showcase. Not yet sent in a real conversation.

## The viewer matched to the reference: composer kept, one bar

- **The composer stays.** On the chat page a frame no longer opens an overlay: it asks
  the page (`MediaViewerHostContext`) to lay the viewer over the transcript, dark and
  blurred, with the composer kept above it (placeholder "Describe an edit to this
  image"). What is typed while a picture is open is sent with the picture attached;
  when Markup, Comment or Erase has marked it, the mask goes as a second image and the
  words are framed as an edit of that area or spot (`MediaViewerHandle.prepare`, called
  from the page's send). A successful send closes the viewer. Escape puts a tool down,
  then closes. Changing conversation closes it.
- **One bar.** Grip (drag to move it), Markup, Comment, Remove BG, Erase, Resize, as one
  dark rounded bar. The tool in use is lit; its controls follow a divider in the same
  bar (undo; the ratios for Resize; "Erase marked" for Erase; a hint for Markup and
  Comment, whose words come from the composer). Comment places one spot instead of
  strokes.
- **No prompt caption** under the picture.
- **Elsewhere** (the showcase), `MediaLightbox` is the same viewer in an overlay with
  no composer, so Markup and Comment take an inline field.
- **Typecheck note.** `tsc --noEmit -p .` checks nothing in this solution-style config;
  `pnpm -C STUDIO typecheck` (`tsc -b`) is the real check. Earlier "clean" typechecks
  in this phase that used the former were rerun with the latter now and pass.
- Checked: typecheck (`tsc -b`), lint, 816 chat/artifact/showcase tests; the bar and
  brush in the showcase overlay. The chat-page version, with the composer under it,
  has not been seen in a real run.

## The workspace as activity, the sheet, the plan pill, titled commands

Decided with the person on 2026-11-08: the workspace shows what the conversation is
doing now, not its history, and viewers opened from a reply move to a sheet that
works at any window size.

- **What the workspace holds.** The plan, the agents the conversation started, the
  background commands, and the live browser or computer. Grouped "Now" and "Finished".
  Removed: the per-turn task history (`workspaceTasks`, `WorkspaceOverview`,
  `useWorkspaceTasks`), the agent transcript (`AgentInspector`, replaced by
  `AgentActivity`: status, stop, the last six step labels, the result line), artifacts,
  file previews, change reviews and recorded web previews as rail entries. The store
  (`RailProvider`) now takes one published `Activity` per conversation plus the live
  browser report, and a single open view.
- **Where it draws.** `docked` is true when the window is at least
  `minPageWidth + RAIL_MIN_WIDTH + railGutter` (864px). Docked: the column beside the
  conversation, as before (the page still rounds its corner against it). Not docked:
  no column and no overlay; a pill over the composer opens the same list as a floating
  card, and picking a row opens it in the sheet. A sheet showing a workspace thing moves
  into the column if the window grows. The header's Workspace item is offered only
  when docked.
- **The sheet** (`features/chat/sheet`). The image viewer's layer generalised: a file
  preview, a set of changes, or one workspace thing, over the transcript, with the
  composer kept ("Ask about <name>"). Back returns to the list when opened from it;
  Escape and Close close it; a sent message closes it. Files' Preview, "View changes"
  and "View current status" now open here.
- **Cut.** Artifact "Open larger" (artifacts render inline) and the in-app web preview
  ("Studio preview"); a web preview opens in the default browser.
- **Plan pill.** Back as its own pill beside the workspace pill: "1 of 3 · <running
  item>", shown only while some item has no outcome, so it goes when the plan is done.
  It opens a floating card with the plan (tickable, as in the panel) and what this run
  changed: files, lines added and removed, from the file tools' receipts since the
  person's last message.
- **Titled background commands** (harness). The `shell` tool takes `title` (1–80
  characters) and requires it with `background: true`, refused at parse time. The
  title is kept on the job, returned in its status, named in the jobs listing and the
  start answer, and shown in the workspace row and the commands panel, with the command
  line as detail. Jobs from before carry `title: null` and show their command. Not a
  new boundary: the job's existing `background.job` observation is unchanged.

### Revised the same day: one pill, the card, the record, the sheet's spacing

After the person compared it with the reference (Codex's single "2 files changed +11 -0"
pill) and a screenshot of the sheet:

- **One pill, centred** (`WorkPill`), replacing the plan pill and the workspace pill. It
  leads with the plan ("2 of 4 · <running item>"), else "N running", else "Working",
  then this turn's "N files changed +a -r". It shows while anything is going (the
  turn, an unfinished plan, a live agent, command or browser), then "Plan complete" or
  "Done" for 8 seconds (`DONE_LINGER_MS`), then goes. Opening an idle conversation shows
  no pill.
- **The card** (`WorkCard`), above the pill with a 12px gap from it: the plan, this
  turn's files with their line counts (each opens its diff in the sheet), what is
  running, and "Everything in this conversation".
- **The record.** The workspace list gains "Changes": one row per turn that changed
  files, newest first, with its time and line counts (`useTurnChanges`, from the file
  tools' receipts). Groups are Now, Changes, Finished. In a compact window it opens as
  the sheet; docked, it is the column. The header's Workspace item now always opens it.
  Past plans are not listed: the harness keeps only the conversation's current plan.
- **The sheet's spacing.** Its Back/title/Close row now sits in the header band it
  covers (it sat a full header-height lower, under an empty band), and its body stops
  12px above the composer instead of 4px.

### Revised again: a short pill, motion, and a plainer card (2026-11-08)

- The pill says "Plan 2 of 4", not the step's text, then this turn's files and line counts.
  Files show only while the turn itself is running; a server still running after the turn
  no longer keeps the turn's files on screen. A turn that is only writing words shows no pill.
- Done lingers 10 seconds (`DONE_LINGER_MS`), then the pill goes.
- Motion: numbers roll digit by digit (`components/motion/Rolling.tsx`, `RollingNumber`), changed
  words slide (`SwapText`), the pill eases to its new width, and the pill and card share one
  surface (`layoutId`) so the pill grows into the card. The sheet rises from the bottom, scaled,
  so opening the workspace from the card reads as the card growing into it.
- The card (w-80): no title bar, no ruled headings; small labels over Plan (its own compact step
  list), Files and Running. Running rows are one line with a square Stop icon (existing job stop
  and agent cancel paths, no new boundary). One expand icon in the corner opens the workspace;
  "Everything in this conversation" and the close button are gone.
- Not yet seen in the running desktop app; the showcase specimen is steppable to exercise each
  animation.
