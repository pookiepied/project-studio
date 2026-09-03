# Task 52 - The code that never reached the surface

Studio has four unrelated ways of deciding what an error means and no way of
saying it consistently. The harness already sends a machine-readable `code` on
more than half its error responses; the seam already parses it; and not one
surface in the app has ever read it. Everything a person sees about a failure
is either a raw wire sentence or a paraphrase invented at the point of display.

This task makes the failure vocabulary one vocabulary, owned at the source,
and gives it one presentation with three sizes.

It is a refactor with a visible result. Nothing here is new behaviour, and if
it is done correctly the app does the same things it did before, in the same
places, saying better sentences.

---

## Part 0 - What is actually true, measured

Every number below was taken from the working tree on 2026-09-04. Re-take
them; they are cheap, and a brief that is out of date is worse than no brief.

1. **The harness has a code convention, and half-uses it.** 31 error
   responses in `STUDIO HARNESS/src/transport/http/`; 18 carry a `code`.
   Six distinct codes exist today, all dotted `namespace.reason`:
   `admission.client_type_required`, `admission.scope_required`,
   `admission.unauthenticated`, `conversations.invalid`,
   `credentials.invalid`, `providers.icons.unknown`.
   The other 13 send `{ error: "<sentence>" }` and nothing else.

2. **The seam already carries it.** `HarnessFailure` in
   `STUDIO/src/platform/harness/client.ts:122` has `code?: string` on its
   `harness-error` member, and `client.test.ts:335` proves a real code
   arrives intact (`models.configuration`).

3. **No surface reads it.** Grep the whole of `STUDIO/src` for a read of a
   failure's `code`: the only hits are `client.test.ts` and the two files
   from Task 51's follow-up (`HarnessDownPage.tsx`, `DiagnosticWindow.tsx`),
   and those two display a *different* code invented in the frontend. The
   harness's code reaches the webview and dies there.

4. **There are four vocabularies, none aware of the others.**
   - `SeamFailure` - `conversation.ts:119`. Six kinds: `no-harness`,
     `refused`, `rejected`, `broken`, `unreachable`, `malformed`.
   - `HarnessFailure` - `client.ts:122`. Four kinds: `not-reachable`,
     `unauthorized`, `harness-error`, `malformed-response`.
   - `FailureKind` - `features/chat/transcript/failure-kind.ts`. Three kinds
     about model turns: `quota`, `rate-limited`, `unclassified`. Classifies
     by substring-matching the provider's sentence.
   - `HarnessFailureKind` - `shell/harness-failure.ts`. Eight kinds about
     supervisor start failures. Classifies by substring-matching sentences
     out of `src-tauri/src/harness/supervisor.rs`.

   The last two are the tell. Both work by reading English written somewhere
   else and guessing. Both are honest about it and degrade safely, and both
   are reverse-engineering that breaks silently the day someone rewords a
   message.

5. **33 files touch failure display or vocabulary.** Get the list with:
   `grep -rln "StateNote\|failureRemedy\|SeamFailure\|HarnessFailure" --include=*.tsx --include=*.ts STUDIO/src | grep -v test`

6. **`StateNote` is the closest thing to a shared presentation** and is
   title + detail + optional action, nothing more. It has no notion of a
   code, a kind, or a remedy distinct from the detail.

## Part 1 - Every harness error carries a code

Finish the convention that is already there. All 31 responses, not 18.

The shape is fixed and is what the seam already parses:

```json
{ "error": "<sentence, for a log>", "code": "<namespace>.<reason>" }
```

Rules for codes, which are an API and therefore permanent:

- Dotted, lowercase, `namespace.reason`. The namespace is the area
  (`admission`, `conversations`, `credentials`, `providers`, `mcp`,
  `models`, `turns`), the reason is what went wrong.
- A code names a **cause**, never an HTTP status and never a message. Two
  routes failing for the same reason share a code; one route failing for two
  reasons needs two.
- Codes are added, never renamed or repurposed. A rename is a new code and
  the old one stays until nothing sends it.
- The sentence stays exactly as it is. It is for a log and it is good at
  that. Nothing in this task makes harness prose user-facing - the opposite.

Write them down. `STUDIO HARNESS/src/transport/http/codes.ts` (or wherever
the harness's conventions put such a file) holds the union type and a short
line per code saying what causes it. The route imports the constant; no
route may write a code as a string literal.

## Part 2 - The supervisor stops being read like tea leaves

`shell/harness-failure.ts` classifies a start failure by substring-matching
sentences out of `supervisor.rs`. It works and it is documented as a
workaround. Remove the need for it.

Give `HarnessStatusReport` a code beside its message. `supervisor.rs` knows
exactly why it failed at every `Err` site - it does not need to be guessed at
from the outside. The eight kinds already enumerated in `harness-failure.ts`
are the right set and were derived from the real `Err` returns; carry them
across rather than reinventing them:

| Rust site | code |
|---|---|
| server path not resolved | `harness.not_found` |
| `cmd.spawn()` failed | `harness.node_missing` |
| exited before readiness / stream closed | `harness.exited` |
| readiness timeout | `harness.timeout` |
| malformed / invalid / wrong host frame | `harness.bad_handshake` |
| job object create or assign failed | `harness.containment_refused` |
| start in flight, did not settle | `harness.busy` |

`harness start aborted by shutdown` is deliberately absent: the supervisor
already clears `last_error` for it, so it never reaches a surface.

Then delete the substring matcher. `classifyHarnessFailure` and its `ANCHORS`
table go; `describeHarnessFailure` stays and switches on the code it is
handed. Its tests move with it - the ones that assert real supervisor
sentences become tests that the *Rust* emits the right code, which is where
that assertion belongs.

Do the same to `failure-kind.ts` only if the harness can honestly supply the
answer. It classifies provider settlements (`quota`, `rate-limited`) by
matching a model SDK's wording, mirrored on purpose so no SDK enters webview
code. If the harness knows the class at settlement time, send it and delete
the mirror. If it genuinely does not, **leave it alone and say so in the
report** - moving a guess from one side of the seam to the other is not
progress.

## Part 3 - One vocabulary, one table, one presentation

### The vocabulary

One module: `STUDIO/src/platform/errors/` (name it as the codebase's layout
dictates; it is platform-level because both the seam and the shell need it).

```
StudioError = {
  code: string          // the harness's code, or a local one for what
                        // never leaves the client
  detail: string        // the wire sentence, verbatim, never shown as the
                        // headline
  scope: 'connection' | 'request' | 'turn' | 'local'
}
```

`scope` is the thing that decides *where* it is shown, and it is the rule
Task 51's follow-up established for the harness-down page, generalised:

- `connection` - Studio and the harness cannot talk. Replaces the shell.
- `request` - the harness answered and refused. Shows where it happened.
- `turn` - a model turn settled badly. Shows in the transcript.
- `local` - our own bug (`rejected`, `malformed-response`). Shows where it
  happened and says it is a defect, because it is.

### The table

One file maps code to copy. Nothing else in the app may write failure prose.

```
{ code: 'harness.timeout',
  headline: 'The harness did not become ready.',
  remedy:   'The harness started but did not report readiness before the
             startup timeout. Start it again. If this repeats, check whether
             a firewall is blocking local connections.' }
```

Unmapped codes are a normal, supported state, not a gap: show the code and
the detail, with no remedy. Never a blank, never a guess, never a paraphrase
of a sentence nobody classified. There must be a test that an unknown code
renders and that its entry is absent rather than fabricated.

### The presentation

Three sizes, one component family, and **no surface may hand-typeset a
failure again**:

1. `ErrorNote` - inline. Replaces every hand-built `StateNote` failure. Row,
   pane, dialog.
2. `ErrorPage` - full window. The generalisation of `HarnessDownPage`; used
   only for `scope: 'connection'`.
3. `DiagnosticWindow` - the existing one. Already correct. It shows a code
   and a body and knows nothing about what produced them, so it generalises
   by being given a different body.

## Part 4 - How these look, stated rather than judged

This section is deliberately prescriptive. The surfaces this task replaces
were each built by eye and each drifted, and the drift was never visible in a
diff - it was only visible on screen, one control at a time. Treat every rule
below as a constraint, not a suggestion, and if one of them is wrong, say so
in the report rather than quietly doing something else.

**Sizes.** Every action in a failure surface is `size="sm"`. That is what
settings, dialogs and rows already use; `md` is used by nothing and reads as
a control from another application. Check this by grepping `<Button` across
`features/settings/` before you write one.

**Ranks.** At most one `secondary` button - the thing that fixes it. Everything
beside it is `ghost`. No `primary` on a failure surface: nothing here is the
happy path. `danger` only if the action loses data.

**Labels.** A button says what it does, in the words the rest of the app uses
for the same act. If a control elsewhere already performs this action, reuse
its exact label - "Start the harness" is one action with one name, not two.
Never "Try again", "Retry" or "OK": each of those describes the user's hope
rather than the software's behaviour.

**Chrome.** A window's traffic lights are its close button. Never add a second
Close. Never put a page's headline into a window opened *from* that page.

**Capabilities.** Any new window label must be added to `windows` in
`STUDIO/src-tauri/capabilities/default.json`. An unlisted window does not
crash - it silently loses `store:allow-load` and every window permission, so
it opens in the wrong theme with dead traffic lights. This has now happened
twice. Read the comment above that list before adding a window; verify by
grepping the *generated* `gen/schemas/capabilities.json` after a build, not
the source file you just edited.

**Theme.** Every surface must be checked in light and dark. The app is
class-based (`.dark`), driven by `applyAppearance`. A surface that has only
ever been looked at in one theme has not been looked at.

## Part 5 - The copy register

The prose in these surfaces is part of the product and had drifted into
something closer to essay than error message. The register is:

- **Say what happened, then what to do.** Two sentences is the target, three
  the limit.
- **No metaphor, no narration, no second-person storytelling.** "It began and
  then exited before it was ready. Its last output is in the details, and
  that is the part worth sending on" is prose. "The harness process started
  and then stopped before it was ready. The details contain its exit status
  and its output" is an error message. The second one is the house style.
- **Never name a remedy the reader cannot perform.** `pnpm build` is not a
  remedy for someone who installed Studio. If the honest action differs
  between an installed copy and a development tree, name the condition and
  point at the evidence instead of guessing which reader is present.
- **Never repeat a constant that lives somewhere else.** Say "the startup
  timeout", not "30 seconds"; the raw detail already carries the real value
  and a duplicated number goes stale.
- **The wire sentence is evidence, never the headline.** It is written for a
  log and should stay that way.

`harness-failure.ts` after Task 51's follow-up is the reference for all of
this. Match it; do not re-litigate it.

## Part 6 - Migrate the surfaces

All 33 files from Part 0, item 5 - not a representative sample. The point of this
task is that there is one way to do this afterwards, and one hand-typeset
failure left behind is the seed the whole problem grew from the first time.

Order that keeps the tree working: vocabulary and table first, then
`ErrorNote`, then the panes (settings, providers, MCP, archive, models),
then the transcript surfaces, then the shell. `ConnectionNotice`,
`SubmissionFailed` and `AssistantTurn` are the delicate ones - they carry
live-turn state as well as failure, and Task 33's transcript work runs
through them.

Delete as you go. `failure-kind.ts`, `harness-failure.ts`'s matcher, and
every local `describe`/`remedy` helper should be gone by the end. A count of
deleted lines is a real measure of this task and belongs in the report.

## Not this task

- The MCP JSON-RPC error band (`-32020..-32099`). It is a protocol
  vocabulary, is already specified, and does not become an HTTP code.
- Retry policy, budgets, and anything that *decides* on a failure. This task
  changes how a failure is named and shown, never what the software does
  about it. If a code makes a retry decision easier, note it and stop.
- The credential path. No error carries a secret today and none may start;
  `assertNoSecretColumns` and the canary tests stay exactly as they are.
- Archive and delete. That is its own task.
- New failure states. If a surface has no error path today, it does not
  acquire one here.

## Verification

- `pnpm typecheck` clean, both packages.
- Harness suites run **one at a time**, and `STUDIO` vitest green - it is
  532 tests across 54 files today and none of them may be weakened to pass.
- `cargo clippy --all-targets` with zero warnings.
- A test that every code the harness can send has a table entry, and a test
  that an unmapped code still renders with its detail and no invented remedy.
- **A negative control, reported:** break one code's mapping on purpose,
  confirm the unmapped path renders rather than blanking, and restore it.
  Say in the report what you broke and what you saw.
- Screenshots of one inline failure, one page failure and the diagnostic
  window, **in both light and dark**, into `report/shots/`.

The proof this worked is not a green suite. It is that after this task, a new
error requires exactly two edits - a code at the source and a row in the
table - and touches no component at all. Show that: add one deliberately, in
the report, and count the files you had to open.

## Rules

`Backend/`, `docs/`, `prompts/` and `report/` are read-only context. Never
`git checkout`, `switch`, `stash`, `reset`, `clean`, `commit` or `rebase`.
No `any`, no non-const `as`, no non-null `!`. UTF-8, no BOM, LF. No
en-dashes, smart quotes, curly apostrophes, ellipsis characters or emoji in
source. Edit by hand, never with a script - a bulk regex over 33 files is
exactly how this goes wrong. No green placeholder tests, and no test whose
assertion was loosened to accommodate a rename.

Applied migrations are never rewritten; append only.

Report to `report/TASK-52-the-code-that-never-reached-the-surface.md`,
including every place this brief was wrong.
