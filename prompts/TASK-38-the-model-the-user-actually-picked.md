# Task 38 - The model the user actually picked

The picker in the composer shows six models from a file of demo data, and
choosing one of them changes nothing about the request that goes out. The
harness, meanwhile, holds a real catalog: connections, probed providers,
manual models, capability slots, and `GET /api/providers/models` already
serving them. Between the two sits `TurnSettings`, which every component
reads and no submission carries.

This task closes that gap, in the direction the data already flows: the
catalog the harness holds becomes the catalog the picker shows, and the
model and reasoning level a person selects reach the model that answers.

Read `prompts/TASK-37-a-conversation-that-outlives-the-window.md` first for
the boundary this work sits on. Migration 14 left `conversation.model_id`
deliberately empty for exactly this task; you decide whether that is where a
per-turn choice belongs, and you must defend the answer rather than assume
it.

---

## Part 0 - Two facts to settle before writing anything

Neither is guessable from the frontend. Both change the shape of the work.

**0.1 - How a per-turn model can reach the run at all.**

`src/agents/studio.ts` sets `model: STUDIO_MODEL_ID` inside `defineAgent`'s
initializer. That constant is `contracts/models.ts`'s single default. Flue
re-runs the initializer for every run (Task 37 relied on this), so the
initializer *can* read something per run - but it receives only `{ id }`,
the conversation.

Answer, with evidence from Flue's own types and the vendored runtime:

- Can a submission body carry fields beyond `message` to the run that
  results from it, and can the initializer or the turn read them? Quote what
  you found. If it cannot, say so plainly - that is a finding, not a
  failure.
- If a submission cannot carry it, the choice has to be durable *before* the
  run starts. That is what `conversation.model_id` is for. Then answer the
  race honestly: the webview writes the choice and posts the submission, and
  those are two calls. What happens if the run's initializer reads the row
  between them? Do not answer "it will not happen".
- Can a model be changed mid-conversation, and does a run already in flight
  see the change? State the behaviour you are building, not the one you
  hope for.

**0.2 - What the catalog actually returns today.**

Run the harness and call `GET /api/providers/models` against a real
connection - the user's OpenRouter connection if it is configured, and at
least one other kind if you can reach one. Record the real response shape,
not the type. In particular:

- Which capability fields come back populated, and which are the hard-coded
  defaults? `src/models/local/runtime.ts:96` writes `reasoning: false` for
  every user-declared endpoint. Say how many models in a real answer carry
  honest capabilities and how many carry that default.
- Does anything in the response name per-model reasoning levels? Pi's
  `Model.thinkingLevelMap` is the field that would (`Partial<Record<"off" |
  ThinkingLevel, string | null>>`, `null` meaning unsupported). Is it
  reaching our contract, our store, or neither?

---

## Part 1 - The picker reads the catalog

`STUDIO/src/domain/models/catalog.ts` is demo data whose own docblock says
"replacing this file with a fetch is the whole migration". Do that, and
nothing more decorative than that.

- The catalog comes from the harness through the typed client, parsed
  through contracts the same way Task 37's index is. No wire type reaches a
  component.
- The three states the store already distinguishes - loading, no harness,
  failed - apply here too. A picker that cannot reach the harness says so;
  it does not show six models that do not exist.
- **No connections configured is a real state, not an error.** It is the
  state a new install is in. What the composer shows then should point at
  Settings, once, without nagging.
- The demo file goes away, or it stays only if something still reads it -
  and if something still does, say what and why.

**Icons.** The provider icon and the model's author are different facts and
the user has asked for both, correctly: a model reached through OpenRouter
shows OpenRouter on the connection in Settings and Anthropic's mark on the
model in chat. Establish that distinction now, in the data, even if only one
of the two surfaces uses it yet. Do not paint one icon in both places and
call it done.

---

## Part 2 - The choice travels with the turn

`TurnSettings` carries `modelId`, `effort` and `permission`. This task
carries the first two. Permission modes are Task 40's; leave them alone
beyond not breaking them.

- A submission goes out with the model the person chose, by whatever
  mechanism Part 0.1 established.
- `conversation.model_id` gets written when a conversation's model is
  settled. It exists for the sidebar and for reopening a conversation with
  the model it was being held with - so reopening one must restore that
  choice rather than reset to the default.
- The default itself has an owner: `GET /api/providers/defaults` already
  exists (`setDefault`/`getDefaults`, per capability slot). Use it. A second
  notion of "the default model" living in the webview is the same duplication
  Task 37 removed from titles.

---

## Part 3 - Reasoning is per model, not a fixed list

The composer offers Minimal / Low / Medium / High / Max to every model,
including ones that cannot reason at all, and Task 36 proved the value was
being dropped before it reached the request.

- The levels offered come from the selected model. A model with no reasoning
  support offers none, and the control is absent rather than present and
  inert.
- `default` is a real value and means the provider's own default - not a
  synonym for medium, and not the absence of a choice. Model it as such.
- Pi's `ThinkingLevel` has six values including `xhigh`; the webview's
  `Effort` union has five and is missing it. Reconcile them in one place.
  Two vocabularies for one concept is what the provider memo warns about.
- Whatever value ends up chosen must be observable in the outgoing request.
  Task 36's wire test - asserting the request body's `reasoning_effort` -
  is the shape to follow. A test that only proves the value reached our own
  adapter proves nothing; the bug it missed lived past that point.

---

## Part 4 - Person verification

Not tests. You, driving the built app, and reporting what you saw.

1. A fresh install with no connections: what does the picker show?
2. Configure a connection, pick a model, send a turn. Did that model answer?
   Say how you know - the wire, not the label.
3. Pick a reasoning level, send a turn, and show the request carrying it.
4. Pick a model with no reasoning support. What happened to the control?
5. Reopen a conversation held with a non-default model. Which model is
   selected?
6. Kill the harness with the picker open. What does it say?

Live provider turns spend the user's money: one short message per check, no
loops, no benchmarks. The key never appears in a log, error, fixture,
screenshot, test, or report.

---

## Explicitly not this task

Custom model creation, the library-provider browse flow, the remaining six
protocols, image input and capability gating, permission modes, project
sandbox binding. Each is its own task and each is easier once a real catalog
is on screen.

---

## Constraints

- Applied migrations are never rewritten. Append only; migration 15 if you
  need one, and say why the column you want was not already added in 14.
- No `any`, no non-const `as`, no non-null `!`.
- API keys never enter a record, a response body, a log, or the webview's
  storage. `CredentialStatus` is the only thing that crosses.
- UTF-8, no BOM, LF. Em dash in comment prose only; no en dashes, smart
  quotes, curly apostrophes, ellipsis characters, or emoji in source.
- Never leave a green placeholder test.
- Do not edit files with a script. Edit by hand, including report headings.
- Forbidden: `git checkout`, `git switch`, `git stash`, `git reset`,
  `git clean`, `git commit`, `git rebase`. `Backend/`, `docs/`, `prompts/`
  and `report/` are the user's - read them, never modify them, never
  `git add` them.

## Verification

- `pnpm typecheck` in `STUDIO HARNESS` and `npm run typecheck` in `STUDIO`,
  both clean. The harness typecheck is not optional and has been missed
  before.
- Both vitest suites, one at a time - concurrency produces bogus ENOENT
  failures. Report counts, and name any failure you did not cause.
- `cargo clippy --all-targets` with zero warnings if you touch Rust.

## Report

`report/TASK-38-the-model-the-user-actually-picked.md`, and in it:

- The two Part 0 answers, with the evidence that settled them.
- The real `GET /api/providers/models` response shape, and how much of it is
  honest versus defaulted.
- What you did about the `Effort` / `ThinkingLevel` mismatch, and where the
  single vocabulary now lives.
- The six Part 4 observations, as observations. If a step could not be run,
  say which and why - a named gap is worth more than a filled-in claim.
