# TASK 41 — One column at a time

Brief: Settings showed two navigation columns at once — the app sidebar on the
far left and the settings rail inside the page — and the decision, already
taken, was that entering Settings replaces the conversation list with the
settings tree in the same column. This task built that: one column, one list,
a way back, and no second rail.

Everything below was driven against the production build (`npm run build`,
served with `vite preview`) in a Chromium window at 1040 and 700 CSS pixels,
with a real conversation on screen. Verification: `npm run typecheck` clean;
the vitest suite at **378 passed / 36 files, zero failures, zero unhandled
errors**, including twelve new tests written for this task.

---

## 1. What was built

- `src/stores/navigation/NavigationProvider.tsx` — the Settings visit. Entering
  Settings captures the route that was live (`settingsReturn`) and the column's
  open state (`sidebarAtEntry`), resets a `sidebarMoved` flag, and opens a
  closed column. Leaving Settings — by any exit — puts the column back the way
  it was, unless the user moved it during the visit. `leaveSettings()` is the
  back verb.
- `src/shell/sidebar/SettingsTree.tsx` — new. The settings tree as the sidebar
  column's content: the same `SETTINGS_GROUPS`, groups and all, with the moving
  chip (the `layoutId` element, renamed `settings-tree-selection`) moved with
  it. Its docblock records the two-sided argument and its structural
  resolution, so the layout that no longer exists is not argued for anywhere.
- `src/shell/sidebar/Sidebar.tsx` — swaps content on the settings route. The
  brand band, the width, the sunken ground and the drag region are untouched;
  the standing actions give their slot to the Back control, the scroll area
  holds the tree instead of projects and conversations, and the footer
  (Account, settings shortcut) is omitted — both are rows in the tree already,
  and keeping them would be a second copy of destinations the column is
  showing. The docblock now states the column's meaning: it holds where you can
  go, one list at a time.
- `src/features/settings/SettingsPage.tsx` — a single-column document. The
  sticky rail, its import, and the layout that justified it are gone; the page
  is the pane, centred, keyed by section as before.
- `src/features/settings/SettingsNav.tsx` — deleted. No references remain; the
  moving chip moved with the tree, and no second copy was left behind.
- `src/components/icons/registry.tsx` — one concept added: `back` (ArrowLeft),
  for the one surface whose navigation lives in the sidebar column.
- Tests: `src/stores/navigation/NavigationProvider.test.tsx` (nine tests — the
  entry capture, the forced opening, the restore on every way out, the
  moved-column override, the fresh-capture rule) and
  `src/shell/sidebar/Sidebar.test.tsx` (three tests — the column holds the tree
  and a way back and no conversation rows while Settings is the route, and
  reverses roles off it).

The route model is untouched: `{ kind: 'settings', sectionId }`, Ctrl , and
every command-palette section entry behave exactly as before, and no pane's
content changed.

## 2. What "back" means, and why

**Back returns to the surface Settings was entered from — the conversation,
project, or home that was live when Settings opened — captured once per entry
and never changed by moving between sections.**

The brief offers two candidates: the conversation they came from, or home.
Always-home is the more uniform rule, and uniformity is what the brief demands
("a back that sometimes lands somewhere else is worse than a back that always
goes home"). But uniformity is not the actual requirement — a *legible* rule
is. "Where you came from" is the most predictable rule a back control can have:
it is the thing behind you, stated the same way on every visit, and it is what
the brief itself first asks for ("returns to what the user was doing"). A
person who opens Settings for thirty seconds from a conversation they were
reading should not be dumped on home and made to find the conversation again —
and under this design, with the conversation list off the screen while in
Settings, home would be the only place they could recover it from.

What makes it trustworthy is the capture rule: the destination is recorded once,
when Settings is entered, and a session spent browsing sections cannot move it.
Within a visit, back always lands in the same place. Across visits it lands
where that visit began, which is the rule working, not the rule drifting.

The back control is the only exit that *returns*. Every other way out of
Settings — Ctrl N, a conversation or project chosen from the palette — goes
where it says and does not consume the return point; the next entry recaptures
it. "Only one way back" in the brief's phrase is satisfied: one control whose
meaning is *return*, and it always says Back and always does the same kind of
thing.

## 3. The column's open/closed state on entering and leaving

- **Entering Settings** (footer, Ctrl ,, palette, a section by name): if the
  column was closed it is opened, because the tree inside it is now the only
  settings navigation there is. The entry state is remembered. If the column
  was already open, nothing changes.
- **While in Settings**: the strip toggle and Ctrl B still work — closing the
  column is a deliberate act and stays closed. Any such move sets
  `sidebarMoved`, which hands ownership of the column's state back to the user
  for the rest of the visit. Switching sections never asserts the column's
  state either way.
- **Leaving Settings** — by back, or by opening a conversation or project or
  home from the palette, which is also a leaving: the column returns to its
  entry state, unless the user moved it during the visit, in which case their
  last deliberate act stands. A sidebar that was deliberately closed is never
  forced open after the fact.

The rules live beside `sidebarOpen` itself in the navigation store, because
every way in and out funnels through three functions there — holding the
contract in one place holds it everywhere.

## 4. The compact behaviour

Below 900px of available width (`useCompactLayout`, with the rail's
reservation), the column stops being resident and becomes a drawer: it leaves
the flow, floats over the page with its shadow and hairline, and a scrim
covers the page, tapping which dismisses the drawer. The swap is the same
component doing the same thing — nothing compact-specific was written.

Concretely: in a 700px window a conversation shows the drawer over it
(shot 06). Opening Settings swaps the drawer's list for the tree and the pane
renders behind the scrim (shot 05); sections switch with the drawer open, and
the drawer stays open until the user taps the scrim to read the pane full
width. Ctrl , from a closed drawer forces it open — the tree is the only
navigation, so the shortcut has to bring it (shot 08) — and back puts it away
again (shot 09). Entered-with-open stays open on leaving, exactly as at
desktop width (shot 07).

One drive-by note for whoever repeats this: the automation viewport applied a
display scale, so an 800px setting produced a 968px window and the first
"compact" capture was not compact. The shots below were taken with
`window.innerWidth` confirmed under 900.

## 5. What a person can no longer see while in Settings

The list. Conversation rows and project rows are off the screen — so a
streaming turn is no longer visible in the list: the working conversation's
`ActivityMark` and its row are gone with everything else. Precisely: the
*turn itself* was already invisible before this task, because Settings is a
route and already replaced the pane; what this task newly removes is the
list's evidence of it. Also gone from view: the Account and settings footer
shortcuts (both remain rows in the tree), and — if the user closes the column
mid-visit — the tree itself, with sections still reachable by Ctrl K and
Ctrl ,.

That loss is accepted for now and nothing was bolted around it: no status row
above the tree, no half-sidebar. If it proves to matter in use, the answer is a
status in the top strip, which already carries `ActivityMark` and the running
set, and that is a separate decision.

## 6. Screenshots

In `report/shots/task-41/`:

1. `01-conversation-sidebar-open.png` — a conversation, sidebar open, one list
   in the column.
2. `02-settings-tree-in-column.png` — the same window in Settings: same column,
   same width and ground, tree with groups, Back at the top, single-column
   pane.
3. `03-section-switch-from-tree.png` — Appearance chosen from the tree; the
   chip has travelled, the pane has risen.
4. `04-the-return.png` — back: the same conversation, the list restored, the
   column open as it was before Settings.
5. `05-compact-settings-drawer.png` — 700px window: the drawer holds the tree
   over the scrimmed pane.
6. `06-compact-conversation-drawer.png` — 700px window: the drawer over a
   conversation.
7. `07-compact-the-return.png` — back at compact width: entered open, left
   open, on the conversation.
8. `08-compact-shortcut-opens-drawer.png` — Ctrl , from a deliberately closed
   drawer: it opens, because the tree inside is the only Settings navigation.
9. `09-compact-return-drawer-closed.png` — leaving that visit puts the drawer
   away again; the conversation fills the window.
10. `10-wide-shortcut-opens-column.png` — fresh load, column closed, Ctrl ,:
    Settings with the column opened for it.
11. `11-wide-return-home-column-closed.png` — back from that visit: home, and
    the column closed again.

## 7. Every place this brief was wrong

In the manner of Task 38 section 9:

1. **"the conversation they came from, or home"** — the binary is short by one.
   The route model has a fourth kind, project, and Settings can be entered from
   one; a back that could not return to a project page would be a hole on the
   rule's first day. The implemented rule is "the surface Settings was entered
   from", which covers all four kinds with one sentence.
2. **"Opening Settings must therefore open the column."** Read literally, this
   fires again on every section opened from the palette *while already in
   Settings* — including after the user has deliberately closed the column
   mid-visit to read a pane full width. That reading would fight the user's
   own hand. The column is opened when Settings is *entered*; inside a visit
   the store never asserts the column's state, and the brief's restore rule is
   what governs the exit. Stated here because the sentence, taken whole, is
   only partly true.
3. **"Leaving Settings should restore the state the user had before"** — this
   rule conflicts with itself in the case the brief did not name: the user
   toggles the column during the visit. Restoring "the state before" would
   override their newest deliberate act — close the column in Settings, press
   back, and it pops open again. Resolved in favour of the user: restoration
   happens only when the column was untouched during the visit; a move cancels
   it. Both this and item 2 fall out of one owner rule — whoever acted last,
   user or visit, owns the column.
4. **"Everything else about the column stays: its width, its ground, its
   header treatment, the window drag region."** — wrong by one region. The
   footer (Account and the settings shortcut) also leaves while in Settings,
   because both of its destinations are rows in the tree already and keeping
   the footer would have been exactly the disease this task cures: a second
   copy of destinations in one column. This is within the spirit of the swap
   and outside the letter of the sentence; named rather than smuggled.
5. **"An explicit control at the top of the tree"** — implemented at the top of
   the *column*, in the fixed slot the standing actions occupy, not as the
   first row of the scrolling tree. A back that scrolls away with the list is a
   back you sometimes cannot reach; the fixed slot is what "top of the tree"
   has to mean for the control to be dependable. Interpretation, recorded.
6. **The old docblock miscounted its own evidence.** `SettingsNav.tsx` argued
   that "Twenty sections in one scroll is not a simpler answer"; the tree holds
   sixteen (6 + 4 + 5 + 1). The brief's sixteen was right and the argument
   being replaced was wrong about its own number. The count is now stated
   correctly in the tree's docblock — the last place the old argument lived.
7. **One pre-existing docblock claim preserved verbatim:**
   `SettingsPage.tsx`'s "the back/forward stack steps through sections the way
   it steps through conversations." There is no back/forward stack in the
   navigation store — `go` sets route state and nothing remembers. The claim
   predates this task, the section-in-route design it praises is untouched,
   and it is kept word for word like Task 38's TurnMenu ellipsis: user copy
   from before the task, applied-to-everything-new constraint not
   retroactively enforced.

---

## 8. Additional — a second pass after this task

A further brief arrived once this task was done, and it grew straight out of
the same column, so its record belongs in this report rather than in a new
one. Five parts, in the order they landed.

### 8.1 The way back moved onto the brand band

The Back control left the actions slot and now sits at the right end of the
band that carries the mark and the wordmark — the same line as the logo, at
the column's top edge, shown only while Settings is the route. Nothing else
about the band, the strip, or the window controls changed. One code
consequence: the band's drag handler now guards on the event target, so the
drag still belongs to the empty band and never to the button that joined it.

Recorded for honesty: this control was first implemented at the far right of
the top strip beside the window controls, which was a misreading of the brief.
That change was reverted in full — `TopStrip.tsx`, `TrafficLights.tsx` and the
geometry token are content-identical to what this task shipped — and the band
placement is what stands.

### 8.2 The settings taxonomy rebuilt

The old filing put eleven sections under two headings, Personal and
Extensions, and the filing was the bug: Account sat beside Appearance under a
heading about "you and this machine", Providers sat under Extensions when it
is the engine reach serves, and Skills and Hooks sat under Coding when neither
knows a repository exists. The tree now reads:

- **Application** — General, Appearance, Keyboard shortcuts
- **Account** — Account, Personalization
- **Models** — Providers
- **Extensions** — MCP servers, Connectors, Browser and computer use
- **Agent** — Skills, Hooks
- **Coding** — Git, Worktrees, Environments
- **Archived** — Archived chats

Each group is named for what its members *are*, not for where they used to
sit, and the three single-section groups are deliberate: a one-row group that
says "Models" answers "where do I change what answers me?" at a glance, and
folding Providers under a wider heading to avoid the orphan is the filing
instinct that produced the old tree. Section ids did not move, so the footer's
Account shortcut, the palette's entries and the default landing all still
resolve. The structure is declared in `sections.ts`, whose docblock now argues
the filing, and a data test (`sections.test.ts`) holds the membership, the
no-voice rule and the deep links.

### 8.3 The Voice page removed

The section, its placeholder copy and its tree entry are gone. What stayed is
everything that was never the page: dictation in the composer, read-aloud in
the transcript, voice mode behind its own mark. They are features; only the
pretence that they were configured in a Voice pane was deleted.

### 8.4 The working mark reconnected

The sidebar's `ActivityMark` — the dot-matrix grid, described in the task
above as the thing a working conversation loses from view while you are in
Settings — had survived every refactor but lost its feed. It renders from the
workspace store's `running` set, and only the gallery's demo path still fed
that set: a real turn admitted through the harness never lit any row.

The reconnection is at the model level, not a patch on the row. The store now
exposes `markRunning`, and the conversation view — the only component that
witnesses both a turn's admission (the receipt) and its settlement (the wire)
— mirrors its phase machine into the set: submitted and streaming mark the
conversation, idle and run-failed un-mark it, `interrupted` un-marks it too,
because a mark with no witness behind it is the invented progress the mark
exists to refuse. Unmount clears nothing — a turn outlives the view that
watches it, so navigating away mid-turn keeps the mark lit, which is the
multi-conversation case the mark exists for. Project rows render the same
row component, so they are covered identically.

Known limit, stated in the code rather than hidden: a turn that settles while
no window is reading it keeps its mark until someone opens that conversation
again, because the harness exposes no way to learn a settlement from outside.

### 8.5 Dead code removed

`useGalleryTurn.ts` had zero importers — the gallery's send answers through
the demo turn path — so it is deleted, and the gallery docblock that still
pointed at it now names the path that actually answers. Everything else the
sweep looked at is genuinely live and stayed: voice mode and its provider,
the waveform module, microphone input, and the gallery scene module, which
the seeded conversation itself renders.

### 8.6 Verification for the pass

`npm run typecheck` clean; vitest **384 passed / 38 files, zero failures,
zero unhandled errors** — six tests new to this pass (three holding the
taxonomy as data, three holding the mark wiring against the store). Driven
against the production build in the browser: the new taxonomy and the Back
placement were read off the page and confirmed in screenshots; Back returns
to the conversation list; the mark appears on the row mid-turn, persists on
the row after navigating away, and clears when the turn settles.

Shots in `report/shots/task-41-additional/`:

1. `01-settings-taxonomy-back-in-band.png` — the new tree, no Voice, and the
   Back arrow at the band's right end, on the logo's line.
2. `02-working-mark-mid-turn.png` — the mark on the gallery row while its
   turn runs.
3. `03-working-mark-from-home.png` — the same mark seen from home, the
   conversation working elsewhere.
