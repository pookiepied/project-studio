# The frontend, and why it does not feel finished

**Status:** Captured, not started · **Opened:** 2026-09-08
**Not the current task.** The roadmap is discovery, then the rest of MCP, then
the browser, then providers. This is written down so it survives until the
frontend is the task, and so the next person does not re-derive the
measurements.

---

## 1. What is settled, and is not to be relitigated

These were argued and decided. Reopening them wastes the next pass.

- **Window: 1040 × 720, minimum 600 × 440.** Undecorated, transparent, 20px
  radius. This is the canvas and it is right.
- **UI text: 12px**, with 11/12/13/14 offered. Right for a desktop app — 12 is
  already at the small end of convention, and the perception of "too big" on
  any given machine is more likely Windows display scaling than the value.
- **Instrument Serif stays.** The one statement a page makes.
- **Inter stays.** No better alternative was found, and the reasons replies
  looked wrong in it were bugs, not the typeface — see §5.
- **Hierarchy from weight, colour and tracking rather than size** — correct for
  chrome. Prose is the exception and has already been given a real ladder.

## 2. What is actually wrong

Not the values. The **relationships between** them.

The vocabulary is genuinely good: a type scale with roles, leading tokens,
ratio-based control geometry, a 4px spacing grid, radius and motion tokens, an
icon registry with a uniqueness assertion, and a dev-time check that fails the
build if the scale drifts. That is not an amateur codebase.

What is missing is a layer above the tokens. Tokens govern atoms. Nothing
governs how atoms combine into recurring patterns, so each surface re-solves
problems that were already solved next door. From the September census: seven
"working" indicator vocabularies (`WorkingDots` defined three times with
different delays), four text-input implementations, two overlays that build
their own scrim and portal instead of using `Dialog`, two menus that
re-implement viewport placement.

That is what reads as unpolished. The same concept wearing a different outfit
depending on which file you are in.

## 3. The measured baseline

So nobody greps for this twice.

**Dialogs — four widths for three jobs.**

| Surface | Width | % of 1040 |
|---|---|---|
| `Dialog` default | 26rem / 416px | 40% |
| DeleteConversation, RemoveConnection | 24rem / 384px | 37% |
| NewProject, AddConnection, AddModel | 28rem / 448px | 43% |
| ServerDialog (MCP) | 30rem / 480px | 46% |
| ModelLibrary | `min(72rem, 74vw)` → 770px | 74% |

**Proposal:** three named sizes, no free-form width — `confirm` 24rem,
`form` 28rem, `browse` `min(72rem, 74vw)`. The MCP dialog comes down to 28; it
is not doing anything the others are not.

**A real bug, whatever else happens:** no dialog clamps to the viewport. At the
600px minimum window the 30rem MCP dialog is 80% of the width. Every width
wants `min(<size>, 92vw)`.

**Icons are correctly paired and that is not the problem.** `--icon-xs: ui−1`,
`sm: ui+1`, `md: ui+3`, `lg: ui+9`, text-paired at `1.1em`. An icon at the same
px as its text looks smaller, because font-size is the em box while glyphs fill
about 70% of it — so a 13px mark beside 12px text is optically equal, which is
what the pairing already encodes.

The reason *some* marks look wrong small is **drawing, not size**: Lucide is
drawn on a 24px grid for a 2px stroke, so at 13px it renders at 54% with the
stroke held near 1.2px. Detail-dense glyphs turn to mush; simple ones survive.
The fix is a 16px-grid set for small sizes, or hand-drawing the worst offenders
the way `drawn.tsx` already does for six. Resizing will not help.

**Most likely "too big" widget:** the side rail's 320px minimum — 31% of a
default window, 53% of the minimum one.

## 4. The decision this conversation produced: some dialogs want to be pages

**MCP servers and providers should stop being floating forms and become real
settings pages.**

The reasoning is theirs and it is right: those two carry far more than a
confirm dialog's worth of information — a server has an id, a purpose sentence,
a transport, a command, arguments, environment, auth, provenance and now a
per-scope enablement state. Poured into a 480px column that is a very tall,
very narrow form, and it reads as cramped because it is.

A settings page has the width to lay that out in a way a dialog never will, and
these are configuration surfaces people return to rather than one-shot
questions — which is the actual test for dialog versus page.

**Keep as dialogs:** confirmations, and anything answering one question.

**Already moving this way:** step 4 is adding scope control into `McpPane`, the
page, rather than into `ServerDialog`. Nothing about that work blocks this.

## 5. Already fixed, so the next pass does not look for them

Three defects in the path every message is read through:

- **`overflow-wrap: anywhere` on prose** let the line breaker treat every word
  as breakable when measuring, so ordinary sentences came back with arbitrary
  mid-word splits. Now `break-word`, plus `text-wrap: pretty`. (`a277edf`)
- **Inline markup was not closed while streaming**, so every emphasis rewrote
  itself when its closer arrived and re-wrapped the line, and a link showed its
  full URL before collapsing to two words. Now closed optimistically under
  CommonMark flanking rules, so `2 * 3` and `snake_case` stay upright.
  (`f68cd2c`)
- **`h3` and `h4` both rendered at body size**, so a formatted reply had one
  visible heading rung. Now ratio-based, three distinguishable levels at every
  text setting. (`2a13b37`)

## 6. The order to do the rest in

Theirs, with two changes and the reasons for them.

1. **Delete what is unused** — components, libraries, dead surfaces. Moved to
   the front: it is the only step that makes every later step cheaper, and the
   least risky thing in the list.
2. **Name the missing tokens** — dialog sizes, and anything else chosen
   per-file. Moved ahead of sizing, because sizes derive from tokens; fixing
   them first means fixing them twice.
3. **Fix the sizing relationships** against those tokens.
4. **Decide the palette** — pure black and white, or white and light grey. One
   question, and it should be answered once for the whole app.
5. **Entry and exit animation**, with the presence coordination exit requires.
   Nothing has an exit animation today, and that is architectural rather than
   lazy: exit needs a component held mounted after it leaves state.
6. **One component per concept**, converted one at a time — the seven working
   indicators and four text inputs from §2.

## 7. Open, and needing eyes rather than grep

- Are the widgets actually oversized, beyond the rail's minimum? This needs
  screenshots of every surface and state; it cannot be answered from source.
- Pure black/white versus white/light-grey (step 4 above).
- Whether `h1` at 1.45em is right against the 19px chrome title — proposed from
  arithmetic, never seen rendered.
