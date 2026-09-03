# TASK 38 — The model the user actually picked

Brief: the composer showed six demo models and choosing one changed nothing
about the request; the harness held a real catalog behind
`GET /api/providers/models`, `GET /api/providers/defaults` and a connection
store, and `TurnSettings` was read by every component and carried by no
submission. This task made the harness's catalog the picker's catalog, and made
the model and reasoning level a person selects reach the run that answers.

Everything below was driven against the built harness (`dist/server.mjs`,
rebuilt at the tip of this task) over its real HTTP surface, plus two short
live turns on the user's OpenRouter connection. What still needs a person at
the desktop is named plainly in section 6; none of it is faked.

---

## 1. Part 0.1 — how a per-turn model can reach the run at all

**Answer: it cannot ride the submission. The choice must be durable before the
run starts, and the durable place is the conversation index.** That is a
finding about the runtime, not a failure of the design — and it is the reason
migration 14's `conversation.model_id` exists.

Evidence, from `@flue/runtime@1.0.0-beta.9` as shipped in this workspace:

- The direct-submission payload is closed. `dist/run-store-CYeXjR-d.mjs:11-14`:
  `DirectAgentPayloadSchema = v.object({ message: v.string(), images:
  v.optional(v.array(DirectAgentImageSchema)) })`. Valibot's `v.object` strips
  unknown keys, so anything extra a caller puts in the body never survives the
  parse.
- The parse is the only door. `dist/conversation-projections-XMug3C6A.mjs:614`
  — `parseDirectAgentPayload` returns `parsed.output` and refuses everything
  else ("Direct agent requests must use JSON object body
  `{ "message": string, "images"?: image[] }`").
- The initializer receives nothing but the conversation.
  `dist/types-USSZhfC6.d.mts:88-93` — `AgentInitializerContext` is
  `{ id, env }`; `dist/internal.mjs:684-687` — `initializeRootHarness` calls
  `agent.initialize({ id: config.id, env: config.env })`.
- The submission input is *deliberately ignored* where the run's session
  opens. `dist/conversation-stream-store-Bitz7UoW.mjs:3498` —
  `async function openAgentSubmissionSession(ctx, agent, _input)`: the
  parameter is named `_input`. The run's config comes from the initializer's
  return value alone (`internal.mjs:688-709`).

**The race, answered honestly rather than waved away.** The webview writes the
choice and posts the submission, and those are two calls. What happens if the
run's initializer reads the row between them?

- For turn 2 and later, nothing can: the write happens when the choice is
  made (or, see below, inside the submission request itself, before
  admission), and SQLite commits it atomically. The initializer runs after
  admission and reads a row that already holds what this turn was sent with.
  There is no observable half-state; the only interleavings are
  old-value-before-commit and new-value-after-commit.
- For turn 1 the row did not exist when the submission was posted —
  `WorkspaceProvider.beginConversation` posts it on the receipt, after the
  202 — so a run that started fast would have read no row and taken the
  default. "It will not happen" is not an answer, so the gap was removed
  instead of described: a new middleware
  (`src/transport/http/middleware/turn-settings.ts`) mounted in front of the
  Flue app parses the submission body's `modelId`/`reasoningLevel`, validates
  them against the contract and against the catalog's served references, and
  writes the row **before `next()` admits the run**. For a first conversation
  it creates the row at admission (the title still derives from the message,
  which is in the same body), and if the harness then refuses the send it
  removes exactly the row it created — Task 33's "a refused first send creates
  nothing" holds by rollback. A crash between create and refusal leaves a row
  without a stream, which the conversation routes already name as a tolerated,
  never load-bearing state. A throw (rather than a refusal response) from
  downstream deliberately leaves the row in place: post-admission the stream
  exists and the row is its only index, so deleting would orphan a real
  conversation.
- Two windows choosing different models: whichever PATCH committed last
  before the initializer's read is what the run uses — the same
  last-writer-wins every other index field has. The one ordering that would be
  wrong (submission first, write after) is structurally impossible now, because
  the write is part of the submission request.

**Mid-conversation change: allowed, and a run already in flight does not see
it.** Flue re-runs the initializer for every run
(`openAgentSubmissionSession` per submission → `initializeRootHarness`), so a
change applies from the next run; the in-flight run keeps the model its own
initializer resolved. That is the behaviour built, not the one hoped for — and
it is the same lifecycle the sandbox and cwd already have.

## 2. Part 0.2 — what the catalog actually returns today

Driven against a built harness on a temporary database: one language
connection with `catalogProvider: "openrouter"` (the user's vendor), one
self-hosted language connection with no `catalogProvider` carrying one manual
model, one retrieval connection (`brave`).

The response is an array of `ProviderModel`:
`{ connectionId, modelId, displayName, capability, reasoningLevels, shape,
pricing, hidden, origin }` — 271 rows from the OpenRouter connection, 1 manual
row, 0 rows for the retrieval connection (`ModelCatalog.#baseModels` serves
language only).

How much is honest versus defaulted, counted from the live response:

- **271 of 272 rows carry Pi's generated per-model facts**: `reasoning`
  supported on 185 / unsupported on 86 (never guessed), `vision` supported on
  152 / unsupported on the rest, `contextWindow` numeric on 271, pricing
  numeric on all.
- **`toolCalling` is `"unknown"` on all 272.** Pi's model record carries no
  tool flag and `capabilityFromPiModel` refuses to invent one
  (`src/models/local/catalog.ts:35`). That unknown is honest.
- **The one defaulted row is the manual model on the self-hosted
  connection**: every capability `"unknown"`, every price `"unknown"`. This is
  the same honesty as `models/local/runtime.ts:96`'s `reasoning: false` for
  user-declared endpoints, expressed in the catalog's vocabulary: the harness
  cannot verify a claim about an endpoint it has never probed, so it says
  unknown instead of claiming a default. A real answer's honest-to-defaulted
  ratio is therefore 271:1, and the defaulted row is exactly the kind of row
  the user typed in themselves.

**Per-model reasoning levels were reaching neither the contract nor the
store.** `providerModelSchema` had no such field; `provider_model_manual`'s
`record_json` stores that same shape, so nothing was stored either; Pi's
`Model.thinkingLevelMap` (`Partial<Record<"off" | ThinkingLevel, string |
null>>`, null = unsupported) died inside the runtime. Now the contract carries
`reasoningLevels` — Pi's own `getSupportedThinkingLevels(model)` minus
`"off"`, which is 271 rows' worth of per-model answers, empty for the manual
row — and the webview mirror parses it.

## 3. The picker reads the catalog

`STUDIO/src/domain/models/catalog.ts` no longer contains ten models; it
contains the mapping. The fetch lives in `WorkspaceProvider`, which already
owned the harness client and the restart events: the catalog loads beside the
index (`listConnections` + `listModels` + `getDefaults`), answers for itself
through `ModelCatalogState.phase` (`loading` / `ready` / `no-harness` /
`failed`), and a failed catalog never blanks the sidebar. The demo file is
gone, and with it its remaining readers: `ProvidersPane`'s no-harness fallback
became a plain sentence instead of a fixture list wearing the product's
clothes, `AssistantMessage` lost its `findModel` (it renders only the
gallery's scripted replies now, and those name no model), and the context
meter measures against the selected model's own window. The demo conversation
data (`DEMO_CONVERSATIONS`, `DEMO_PROJECTS`, `longThread.ts`) went too — its
consumers left in Task 37, and the `Conversation` type this task grew is what
finally refused to carry it.

"No connections configured" is a state, not an error, and this machine was
literally in it: the user's OpenRouter lives in the settings world
(`provider_connection` + keychain under the Pi provider id), and the new
connection store had zero rows until one is added. The picker says so once and
points at Settings; no error surface, no nagging.

**Icons: the two vendor facts are now two fields.** A `CatalogModel` carries
`author` — the mark the model itself wears — and `connectionVendor` — the mark
the connection wears. The rule is stated once (`authorOf`): OpenRouter names
the author in its own model ids (`anthropic/...`), a direct vendor connection
is its own author, anything else falls back to the custom mark. A model
reached through OpenRouter now wears Anthropic's mark in the picker and
OpenRouter's on its connection row in Settings. Both are established in the
data; the picker uses both today.

## 4. Part 2 — the choice travels with the turn

The reference format is the load-bearing decision, so it is stated and
defended: **`conversation.model_id` stores `<pi-provider>/<model-id>`** — the
local runtime's own vocabulary, the same shape `default_model` in the settings
store already uses. One string, three consumers that cannot drift: the index
stores it, the initializer returns `project-studio/<reference>` (Flue's
`resolveModel` splits on the first slash, so OpenRouter's slashed model ids
survive), and the local adapter parses the alias's id back out and delegates
to exactly that model (`LocalModelProviderAdapter.#resolveTarget`) — honoured
exactly or not at all, because falling back to the configured default here
would be the picker changing nothing, wearing a quieter shape. Connection ids
are deliberately absent from the reference: they name a keychain entry and a
settings row, not a model the runtime can resolve, and a deleted connection
must not retroactively rename what a conversation was held with.

The default's owner is the harness: `GET /api/providers/defaults`
(`setDefault`/`getDefaults` per capability slot) is now on the typed client,
and the picker's resting row is "Studio default" — `model_id` null, the stable
alias. There is no second notion of "the default model" in the webview.

Selection settles immediately: picking in a conversation writes the row via
the index PATCH (`setConversationSettings`), the window's settings follow, and
the submission body carries the same values — so the admission path's write
and the picker's write converge on one row. Reopening a conversation restores
the row's choice through `effectiveTurnSettings`, one derivation shared by the
picker that displays it and the send paths that use it.

## 5. Part 3 — reasoning is per model, and one vocabulary

**Where the single vocabulary lives: `STUDIO HARNESS/src/contracts/models.ts`
declares `REASONING_LEVELS`** — Pi's `ThinkingLevel` union, all six values —
plus `reasoningChoiceSchema`, which adds `"default"` *beside* the levels, not
as one of them. The webview mirrors it in
`platform/harness/contracts.ts` (the hand-maintained wire mirror) and re-declares
it once in `domain/models/types.ts`; `Effort` — five values, no `xhigh` — is
gone, and with it the last two-vocabularies-for-one-concept on this seam.

Two things the reconciliation surfaced, both fixed rather than papered over:

- **Flue's runtime validation was stricter than the type it re-exports.**
  `dist/conversation-projections-XMug3C6A.mjs` `VALID_THINKING_LEVELS` lacked
  `max`, so `defineAgent` refused a level that pi-agent-core's `ThinkingLevel`
  (which Flue re-exports as its own type) contains and that real models
  support — 16 OpenRouter models and 6 Anthropic ones map it at beta.9's
  catalog. Patched as the third house patch
  (`patches/@flue__runtime@1.0.0-beta.9.patch`), with the re-derivation note
  the other two carry; pi-ai still clamps a level the selected model cannot
  honour, which is its answer to a stored choice whose model changed.
- **"default" maps to the run's `off`, not to Flue's substitute.** Flue
  substitutes `"medium"` for an unset `thinkingLevel`
  (`conversation-stream-store-Bitz7UoW.mjs:711` and `:1518`), so leaving it
  unset would have made default a synonym for medium — exactly what the brief
  forbids. `runThinkingLevelForChoice` maps `"default"` → `"off"`, which is
  how this stack says "no explicit effort requested": the agent loop turns
  `off` into an absent reasoning option (`agent.js:284`), and pi-ai renders
  that per protocol.

The levels the composer offers are the selected model's own, from the catalog
field, with `Default` first on the dial; a model with no levels gets no
control at all, present-and-inert being a control that lies.

## 6. Part 4 — person verification

Driven against the built harness on a temporary database over the same HTTP
surface the webview drives through Rust. **Named gap up front: no desktop
window was observed** — no session here can see a GUI — so the six checks
below are observations at the app's boundary, and the rendering of each state
is pinned by the component suite (`TurnMenu.test.tsx`, new: 6 tests covering
the no-connections sentence, the no-harness sentence, grouping and author
marks, the absent reasoning control, the settling PATCH, and the dial's
steps). The OpenRouter key never appears in any log, body, fixture or report;
the usage read below prints only totals.

1. **Fresh install, no connections.** `GET /api/providers/connections` → `[]`,
   `GET /api/providers/models` → `[]`, both 200. The picker's panel renders
   "No connections yet. Add one in Settings to give Studio somewhere to send a
   request." with one Open Settings item, and nothing else.
2. **Configure a connection, pick a model, send a turn.** Created the
   OpenRouter connection (`credential: "absent"` — the turn uses the
   settings-world keychain entry), picked `amazon/nova-micro-v1`, submitted
   "Reply with the single word: pong." with `modelId:
   "openrouter/amazon/nova-micro-v1"`. 202, settlement `completed`, transcript
   "pong", and the assistant record names the run's model:
   `{ provider: "project-studio", id: "openrouter/amazon/nova-micro-v1" }`.
   That id is the reference the picker stored — the run took the picked
   model. How I know the request itself carried it: the same code path,
   driven at a real wire in `local-byok.test.ts`, shows the outbound request
   body's `model` field is the named target's own id, never
   `project-studio`. One honesty note: OpenRouter's `/api/v1/key` usage total
   did not move within the script's read window (15.84447556 before and
   after), so the provider-side confirmation here is the response, not the
   billing page.
3. **Pick a reasoning level, show the request carrying it.** Picked
   `bytedance-seed/seed-1.6-flash` (catalog levels minimal..high) with
   `reasoningLevel: "high"`: settlement `completed`, reply "pong", and the
   turn's usage carries `reasoning: 60` reasoning tokens on a one-word
   prompt — reasoning was active. The request body carrying the level
   verbatim is asserted at the wire in `local-byok.test.ts`: a mapped model
   sent `reasoning_effort: "max"`, `medium` sent `"medium"`, and — the
   default case — **no `reasoning_effort` parameter at all** when nothing was
   asked.
4. **Pick a model with no reasoning support.** `amazon/nova-micro-v1` ships
   `reasoningLevels: []`; the menu renders no Reasoning item — absent, not
   inert. With the default alias selected the control is also absent: the
   levels belong to a selected model, and the webview cannot know the alias's
   target.
5. **Reopen a conversation held with a non-default model.** The index rows
   after the checks read
   `{ id: cnv_verify_reasoning, modelId: "openrouter/bytedance-seed/seed-1.6-flash", reasoningLevel: "high" }`
   and
   `{ id: cnv_verify_model, modelId: "openrouter/amazon/nova-micro-v1", reasoningLevel: "default" }`.
   The picker restores from exactly these fields via `effectiveTurnSettings`;
   the component test proves a conversation's record outranks the window's
   settings.
6. **Kill the harness with the picker needing the catalog.** The last
   successful read returned 271 models; after the kill, the next read rejects
   with `connect ECONNREFUSED` — the picker's `failed` state names it
   ("Could not read the model catalog. The harness could not be reached at
   …") rather than showing a stale list or six models that do not exist.

Live spend: three completed short turns on the user's OpenRouter connection
(one per check 2 and 3, plus one repeat because the first verification run
used the test model source and had to be redone against `local`), plus one
turn refused by OpenRouter itself before any completion (below). Each was one
short message; no loops, no benchmarks; total cost under $0.001.

## 7. Migration 15, and why the column was not already there

`ALTER TABLE conversation ADD COLUMN reasoning_level TEXT` — appended, never
rewritten. Migration 14 could not have carried it: at that point Task 36 had
only just established that a reasoning request reached the request at all,
and the choice (which level, or the provider's own default) is a separate fact
from which model answers, picked together but stored apart. Nullable on
purpose; null and `"default"` both mean "no level asked for"; nothing is
backfilled, because a backfill would rewrite a fact the user never stated.
Reads go back through `reasoningChoiceSchema`, so a value that predates the
contract reads as default rather than as a level nobody chose.

## 8. Verification — both suites, one at a time

- `STUDIO HARNESS`: `pnpm typecheck` clean; `pnpm test` — **1329 passed /
  30 failed / 25 skipped** across 91 files. Every one of the 30 is the same
  environmental refusal as Task 37's baseline —
  `SandboxError: The sandbox needs one-time setup ... run: pnpm sandbox:prepare
  "C:\Users\pooki"` — in the sandbox-shaped files (`tools/shell`,
  `mcp-launcher`, `mcp-runtime`, `mcp-flue`, `sandbox-appcontainer`),
  individually re-run to confirm. The count drifts (23, 29, 30, 31 recorded
  across tasks); not chased.
- `STUDIO`: `npm run typecheck` clean; `npm run test` — **317 passed / 0
  failed** across 28 files.
- Rust untouched, so `cargo clippy` was not required.
- The Flue patch change re-ran `pnpm patch-commit`; `pnpm-lock.yaml` differs
  only in the patch hash.

## 9. Every place this brief was wrong, and what the work found

1. **"A submission goes out with the model the person chose."** No submission
   can carry it (section 1's evidence). The mechanism is the index row,
   settled by a middleware *inside* the submission request — which also
   answers the brief's race question by removing the gap instead of timing it.
   The brief's Part 0.1 anticipated the shape; the middleware is the part it
   could not have named.
2. **"`default` ... means the provider's own default."** True in intent, only
   partly true at the wire: pi-ai renders "no explicit effort" per protocol —
   OpenAI-completions omits `reasoning_effort` (literally the provider's
   default), OpenRouter format sends `reasoning: { effort: "none" }`, Anthropic
   sends `thinkingEnabled: false`. Default is never medium anywhere, but the
   brief's sentence is exactly true only on the OpenAI-style path. Stated
   here rather than silently absorbed; fixing it would mean patching pi-ai,
   which is out of bounds.
3. **Flue's own validation rejects `max`** — a level of the type Flue
   re-exports, supported by real models in the catalog it ships. Third house
   patch.
4. **Hono 4.12's `req.json()` consumes the raw body**, and Flue's agent route
   clones that same raw request afterwards — my first middleware draft broke
   every plain submission with "Body is unusable" (500 before admission). The
   pre-existing integration suite caught it; the fix is a clone-based read,
   documented in the middleware's docblock.
5. **The bundled catalog offers dead endpoints.** `ai21/jamba-large-1.7` is a
   picker row on an OpenRouter connection and OpenRouter answers
   `404: No endpoints found` — Task 35 section 4's stale registry, now
   user-visible at the picker. The failure is honest (the provider's own
   sentence reaches the stream), but the row should not be offered. Named,
   not fixed — the brief excludes capability gating and catalog curation.
6. **"the user's OpenRouter connection if it is configured"** — it is, but in
   the settings world: zero `provider_connection_record` rows existed, so the
   new-connection store's honest answer was the fresh-install state until one
   is added. Both worlds still exist; this task made the picker read the
   catalog world and the turns resolve through the runtime world, and they
   agree because the catalog is enumerated from Pi's own collection. Merging
   the two stores remains future work.
7. **The brief's "nothing more decorative than that"** for Part 1 under-counted
   by one: the demo catalog's death took the demo conversations with it (the
   `Conversation` type grew, and dead fixture data cannot satisfy it), which
   is a deletion Task 37 declined to do piecemeal. Done here because the type
   system forced it, and reported rather than smuggled.

One pre-existing wart preserved deliberately: `TurnMenu.tsx`'s "Model
library…" ellipsis character is the user's committed copy from before this
task, kept verbatim; the constraint is applied to everything this task added.
