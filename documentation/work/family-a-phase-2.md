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

## Checks

Each task runs the type check and the tests for what it touched. The full client
check runs at the end of the phase, not per task.

End of phase, 2026-11-07: `pnpm -C STUDIO check` passed, 232 files and 1956 tests.
`cargo test --lib` passes, 173 with 2 ignored, with Studio open: the supervisor
tests now run the Harness in a temporary home rather than `~/.studio`.
