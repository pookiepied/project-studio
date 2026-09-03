# TASK 39 — One place a provider lives

Brief: two provider systems had grown without knowing about each other - a
settings world with the rich contract and the HTTP surface but zero rows, and
a runtime world holding the user's real OpenRouter connection, its key, and
the default model every turn actually used. This task merged them into one
store, built a capability-aware catalog over three sources, made the settings
interface a folder of focused components in the webview, and left the seam
Task 40's MCP servers will read.

Everything below was driven against the built harness (`dist/server.mjs`,
rebuilt at the tip of this task) over its real HTTP surface, plus the CLI, plus
two live OpenRouter requests (one completed short turn, one refused). The
OpenRouter key never appears in any log, body, fixture, screenshot, or this
report.

---

## 1. Part 0 - the inventory, from real code and the real database

### The settings world

| Piece | Location |
| --- | --- |
| Rows | `provider_connection_record` (migration 11), `provider_model_override` / `provider_model_manual` / `provider_default` (migration 12, foreign keys 13) |
| Store | `src/providers/connection-store.ts` (`ConnectionStore`) |
| Catalog | `src/providers/model-catalog.ts` (`ModelCatalog`) |
| Probe | `src/providers/connection-probe.ts` |
| HTTP | `GET/POST/PATCH/DELETE /api/providers/connections...`, `GET /api/providers/models`, `GET/PUT/DELETE /api/providers/defaults/:slot`, plus `/api/providers/retrieval/*` |
| Webview | `ProvidersPane` + the `connections/` hook and dialogs |

Readers: the HTTP routes, the Task 38 picker (through `WorkspaceProvider`'s
catalog load), the admission middleware (`servedModelReferences`). Writers:
the same routes. **Row counts on the user's real database before this task:
`provider_connection_record` 0, overrides 0, manuals 0, defaults 0.** The
world the UI talked to had never been written on this machine.

### The runtime world

| Piece | Location |
| --- | --- |
| Rows | `custom_provider`, `provider_connection`, and `app_setting`'s `local.*` keys (all migration 1) |
| Store | `src/models/local/settings-store.ts` (`ProviderSettingsStore`) |
| Service | `src/models/local/provider-service.ts` (`LocalProviderService`) |
| CLI | `src/models/local/cli.ts` (`pnpm providers`) |
| Runtime | `src/models/bootstrap.ts` -> `resolveLocalModelConfigFromSettings` -> `createLocalRuntime` -> `LocalModelProviderAdapter` |

Readers: the agent's model source (every language turn), the CLI. Writers: the
CLI. **Real row counts before this task: `provider_connection` 3 (openrouter,
openrouter-test, google), `custom_provider` 1 (`openrouter-test`, api
openai-completions, models `["stealth/ox-alpha"]`), `local.default_model` =
`{"provider":"google","model":"gemini-3.5-flash"}`.** Settings world: nothing.
This is Task 38 section 9 item 6, now with the numbers attached.

### The two keychain key formats

One OS store, service `Project Studio`, account `<scope>:<id>`, but **two
formats and two locations** - the detail that silently disconnects a carried
row if a merge ignores it:

- **Runtime world**: `{scope: "provider", id: <pi-provider-id>}` ->
  `provider:openrouter`. Value is Pi's own credential JSON
  (`{"type":"api_key","key":...}` or an OAuth token), chunked as
  `v1:<count>:<first>` plus `provider:<id>.1`, `.2`, ... entries, with an
  index entry `provider:index`. All three real entries (`openrouter`,
  `google`, `openrouter-test`) are `api_key` type.
- **Settings world**: `{scope: "provider-connection", id: <connection-id>}` ->
  `provider-connection:<id>`, a raw secret. Zero entries existed before this
  task. The scope split was deliberate: a user connection named `openai` must
  not overwrite the bridge's `provider:openai`.

`~/.studio/data/studio.db` was at `user_version` 14 when this task started;
15 and 16 applied during the work.

## 2. The merge direction, and what did not survive it

**Direction: the runtime world's rows were carried INTO the settings world's
store (migration 16, `provider_store_merge`).** The settings world had the
richer record shape, the probe, model editing, defaults, the HTTP surface, and
the webview; the runtime world had the only rows that mattered. Carrying the
other way would have meant reimplementing the contract's shape under the
runtime, which is not a merge.

Migration 16, in one transaction:

1. Each `custom_provider` row becomes a `provider_connection_record` (kind
   language, its own baseUrl, protocol = the api it was declared with,
   enabled) plus one `provider_model_manual` row per declared model id, with
   the provider-level `context_window` / `max_tokens` attached to each model's
   capability. A `provider_connection` row for the same id is subsumed.
2. Each remaining `provider_connection` row becomes a catalog-backed record
   (`catalogProvider` = the vendor), with `protocol` = the majority api among
   that vendor's own catalog models - the value drives the probe and nothing
   else, and the installed catalog is the only honest source for it.
3. `local.default_model` is carried into `provider_default` as the
   `textGeneration` slot, resolved through `catalogProvider ?? id`.
4. `provider_probe_state` is added (Part 6).

**Credentials moved not at all.** The migration touches no keychain entry.
`src/providers/connection-credentials.ts` (new) is the one credential seam,
and it resolves in a fixed order: the connection's own entry
(`provider-connection:<id>`, raw), then the vendor's legacy entry
(`provider:<pi-id>`, Pi's chunked JSON, api keys only), then the vendor's
environment variable. The runtime's `PiCredentialStore` gained the same
lookup ahead of its own entries, re-reading the merged rows per resolution so
connections added while the harness runs are found. A connection that worked
before works after: same key, nothing retyped (verified live, check 2 below).

Fields that did **not** survive the carry:

- `custom_provider.created_at` and `provider_connection.connected_at` - the
  connection record has no created timestamp; `updated_at` carried.
- A provider-level `context_window` / `max_tokens` on a `custom_provider` row
  whose declared model list is empty - there is no model to attach it to. No
  such row exists on this machine; the general case is dropped knowingly.
- `LocalProviderService`'s per-provider `credentialSource` string, the
  `supportedAuth` listing, and the `managed` flag - the contract expresses
  credential presence only (`CredentialStatus`). The settings surface shows
  "Key stored / from environment / No key", which is the same information the
  old flags encoded.
- The CLI's interactive OAuth/device-code connect flow - see section 4.

The old tables are not dropped (append-only); after migration 16 nothing in
`src/` writes them, and only migration 16 reads them.

**One disclosure**: the user's real database was migrated to schema 16 during
verification, via `pnpm providers list` (the CLI opens the real store by
design). The carried state was then verified against it directly: 3 connection
records, 1 manual model (`openrouter-test/stealth/ox-alpha`),
`provider_default.textGeneration = google/gemini-3.5-flash`, old tables intact.
The first app launch after this task would have done the same thing.

## 3. What happened to `pnpm providers`

It was **repointed at the merged store** rather than retired. Every command
now reads and writes `provider_connection_record` and the model tables through
`ConnectionStore` + `ModelCatalog` - the same stores the settings surface
uses - so a second writer cannot drift from what the app shows:

- `list` / `models` / `default` read the merged store (verified live:
  3 connections with credential states and model counts,
  `Default model: google/gemini-3.5-flash`).
- `connect <id>` creates or updates the merged connection record and stores
  the key under `provider-connection:<id>` - the identical write the settings
  dialog makes.
- `add` / `remove` create and remove merged custom connections and their
  hand-entered models; `select` writes the `textGeneration` default.

Retired with the old store: the interactive OAuth/device-code login. It wrote
tokens only the old credential bridge location could round-trip, no settings
surface ever offered it, and no OAuth credential exists on this machine.
Pi's own token refresh continues to work for credentials already stored; the
credential seam reads the legacy location behind every connection.

## 4. The three catalog sources, verified

One shape out (`CatalogSourceModel`, then `ProviderModel`), three readers:

1. **Pi's language catalog** - `getBuiltinProviders()` / `getBuiltinModels()`
   from `@earendil-works/pi-ai/providers/all`, read live per call. Measured at
   this task's tip: **35 providers, 1072 language models**. Served to language
   connections whose `catalogProvider` matches.
2. **Pi's image catalog** - `dist/image-models.js`
   (`getImageProviders` / `getImageModels`). The subpath is absent from the
   package's exports map (ESM-only, `import` conditions), so the module is
   located with `findPackageJSON` and imported by file path - a deliberate
   deep read of generated data that must move with the package, not a vendored
   copy that goes stale. Measured: **1 provider (openrouter), 35 image
   models**. Served to media connections. Capability mapping: imageGeneration
   supported, imageEditing supported where the model accepts an input image,
   everything language-shaped `unsupported`, shape `sync`.
3. **Studio's declared catalog** - `src/providers/library/declared-catalog.ts`,
   a maintained data file, for everything Pi has none of:
   - under `openai` (one connection serves them beside Pi's chat models):
     gpt-image-1 (images + editing), dall-e-3, whisper-1 and
     gpt-4o-mini-transcribe (transcription), tts-1 / tts-1-hd /
     gpt-4o-mini-tts (speech), text-embedding-3-small/large (embeddings);
   - under `google`: veo-3.0-generate-001 / veo-3.0-fast-generate-001
     (video, shape `poll`), gemini-embedding-001 (embeddings);
   - `elevenlabs` (new provider, new media protocol): two speech voices and
     scribe_v1 (transcription);
   - the five retrieval protocols as one-model vendors: tavily-search /
     tavily-extract, brave-search, exa-search, jina-reader / jina-search,
     firecrawl-scrape.
   Every entry states `textGeneration: "unsupported"` on purpose - that is
   what keeps speech and search models out of the composer while their own
   slots find them. Unstated dimensions stay `unknown`, never `unsupported`.
   Video, speech, transcription, search, and fetch are absent from both Pi
   catalogs (measured, not assumed); this file is the whole of what the
   product can name for those slots today.

`GET /api/providers/library` joins the three into one list with each entry's
kind, protocol, default endpoint, served capability slots, and model count.

## 5. The folder layout, and why

`src/providers/` is now the whole system; separate concerns are separate
files named for what they own:

| Module | Owns |
| --- | --- |
| `connection-store.ts` | The connection rows. Also the table's sync readers (`readStoredConnections`), because the one-owner-per-table rule means the reader lives with the writer. |
| `connection-credentials.ts` | The credential seam: both key locations, the legacy de-chunking, the resolution order. One vocabulary for a question that used to have two answers. |
| `connection-probe.ts` | The probe: per-protocol targets, the served-id capture, the public-list credential check. |
| `model-catalog.ts` | Enumeration (joining manuals + the three catalog sources), availability marks, defaults storage, `servedModelReferences`. |
| `model-edits.ts` | Model editing as its own concern: manual models, overrides, hiding, whole-shelf selection. Owns its two tables outright. |
| `probe-state.ts` | The probe's learned availability, per connection. |
| `capability-defaults.ts` | Capability selection and the Task 40 seam (section 7). |
| `library/language-catalog.ts` | Pi's language models; majority protocol and baseUrl derivations. |
| `library/image-catalog.ts` | Pi's image models, behind the one dynamic import. |
| `library/declared-catalog.ts` | Studio's own declared models. |
| `library/index.ts` | The join: three sources, one shape out, plus the library listing. |
| `management.ts` | `ProviderManagementService`, moved out of `application/` - the port the routes call, nothing more. |

The webview mirrors the discipline: `src/features/settings/providers/` is a
folder of focused pieces (`useProviders` for every harness call,
`ConnectionRow` + `ModelLibrary` + `DefaultsSection` + the three dialogs +
the small shared badges), replacing the one pane that had grown and the
separate `connections/` folder. The composer-side mapping stays in
`domain/models/catalog.ts`; slot display copy lives once in
`domain/models/slots.ts`.

## 6. Protocols: wired, and named unreachable

`API_LOADERS` now wires **six** of Pi's ten language protocols: the original
four (`openai-completions`, `openai-responses`, `anthropic-messages`,
`google-generative-ai`) plus **`mistral-conversations`** and
**`azure-openai-responses`**, both of which authenticate with a single key
(a bearer key and Azure's `api-key` header respectively) and both of whose
modules ship in the installed package.

Named unreachable, with the reason, and not silently absent:

- `bedrock-converse-stream` - AWS SigV4; the credential is an access-key and
  secret pair signed per request. A single API key field cannot carry it.
- `google-vertex` - a service-account credential exchanged for short-lived
  tokens. Same objection.
- `openai-codex-responses` - resolves only a ChatGPT OAuth credential.
- `pi-messages` - Pi's own service protocol; auth is Pi's, not a user key.

Media protocols gained `elevenlabs` (probe target `/models` with
`xi-api-key`).

## 7. Capabilities, defaults, and the seam Task 40 reads

`CAPABILITY_SLOTS` is nine: `imageEditing`, `webSearch`, and `webFetch` joined
the original six, and `ModelCapability` gained the matching fields - the list
is derived in one place, so the defaults schema, the routes, and the webview's
mirror all grew by contract change alone. Every slot is user-settable through
`PUT /api/providers/defaults/:slot`, validated against the model's real
capability fields and its probe-learned availability; retrieval connections
serve declared models, so the web slots are filled through the same door as
chat.

**The seam is `src/providers/capability-defaults.ts`:
`CapabilityResolver.resolve(slot)`** answers exactly the question Task 40's
servers have - which connection, which model, and the credential resolved
through the same chain the probe uses - or `undefined`, never a fallback.
`MergedRetrievalResolver` is the same seam in retrieval vocabulary (vendor id
plus key) and is already wired into the live `RetrievalService` the native web
tools call, so a `webSearch` / `webFetch` default set in Settings decides
which search or reader answers today; the legacy `retrieval.*` keys remain as
a read-only fallback and the `provider:<vendor>` keys as the legacy credential
location.

Where each capability's placeholder begins: **chat and web retrieval are
invoked end to end today.** Images, image editing, video, speech,
transcription, and embeddings have the whole surface - connect, key, model
list, selection, default - and the one honest sentence sits in the defaults
row itself (`DefaultsSection`), which is where the invocation would be
reached from: the `studio-image` and `studio-video` servers are named for the
slots that will drive them; speech, transcription, and embeddings say a
future Studio tool will call them. A placeholder screen is a deliverable;
each sentence names exactly what is missing.

## 8. Part 6's choice, and its cost

**Chosen: the probe learns what the connection can actually serve, and only
those are selectable.** The decision was made by measurement, not argument:
OpenRouter's own `/models` list (380 ids through the probe; 415 in an earlier
direct read - the vendor's own variance) does not name `ai21/jamba-large-1.7`
at all, so the provider is willing to say what it serves for the price of one
request. A successful probe stores the id set per connection
(`provider_probe_state`); the catalog marks catalog-origin rows the set omits
as `available: false`; `setDefault` refuses them; the composer never offers
them; the model library keeps the row visible with the fact stated.

The cost, stated: the mark is one probe old and goes stale as the vendor
changes its catalog; a connection never probed offers everything its catalog
claims (absence of a row must never read as everything unavailable); and the
gating is **language-only**, because the image catalog's ids are not
faithfully enumerated by the same endpoint - measured: `flux.2-max` and
`gpt-image-1` are absent from OpenRouter's list while the image catalog ships
them, so marking image rows from it would mark working models dead. The
wrong-key case forced one more honesty fix: OpenRouter's list is public, so a
wrong key probed green. For that vendor the probe now makes one extra
authenticated request (`GET /key`) before reporting success, and a wrong key
reads `rejected the credential, 401` (verified live). The alternative choice
(marking unavailable after a failed turn) was rejected precisely because this
one is teachable before the user's first dead end.

## 9. Part 7 - person verification

**Named gap up front: no desktop window was observed** - this session has no
GUI, so there are no screenshots. As in Task 38 section 6, the observations
below are at the app's boundary (the built harness's real HTTP surface, the
CLI, and the real OS keychain), and the rendering of each state is pinned by
the component suite: 20 pane tests, 5 hook tests, 5 picker tests, and the
client/contract suites, all passing. The key never appears in any output,
fixture, or log; the driver redacts the admission bearer.

1. **Before and after the merge.** Before: the machine sent turns through
   `google/gemini-3.5-flash` (the runtime world's `local.default_model`),
   with `openrouter`, `openrouter-test`, and `google` connected - and
   Settings showed a fresh install, because the settings world had zero rows.
   After migration 16, Settings (HTTP) shows exactly those three connections
   with `credential: "set"` - nothing retyped - and the `textGeneration`
   default is `google/gemini-3.5-flash`, still listed and available.
   `pnpm providers list` prints the same three rows over the merged store.
2. **Connect a language provider, select a subset, send one turn.** The
   OpenRouter connection was created through the API with **no key**, and the
   chain found the legacy entry (`credential: "set"`). Probe: 380 models
   listed. Catalog: 271 rows; after the probe 249 selectable (22 marked
   unavailable, jamba among them). A three-model selection was stored in one
   request; rows outside it read `hidden: true`. One short live turn
   ("Reply with the single word: pong.") on `amazon/nova-micro-v1`: 202,
   completed, transcript returned (the model's answer began with its thinking
   block, which is the model's own output). Spend: one completed turn, well
   under $0.001.
3. **Transcription/speech, image, web search.** OpenAI (language, keyless on
   this machine -> honest `absent`): whisper-1 and tts-1 arrive as declared
   rows tagged transcription/speech. OpenRouter media connection: `set` via
   the chain, and all 35 image models list. Tavily (keyless): the two
   declared rows list with their webSearch/webFetch tags. How far each gets:
   connect, list, select, and set-default all work; invocation stops exactly
   where Part 5 says it does - the defaults row's sentence - except web
   search and fetch, whose invocation exists today and stops on the missing
   key with the service's own sentence naming the vendor.
4. **Add a model under a library provider.** `studio-ops/task39-hand-entered`
   was added under the OpenRouter connection with reasoning supported, vision
   supported, window 128000, and its own levels `[low, medium, high]`; the
   row is offered in the library and the runtime registers it beside the
   vendor's catalog. A turn naming it was admitted (202), dispatched, and
   OpenRouter refused the id by name ("...is not a valid model ID", 400,
   verified once directly at the wire); the transcript records the assistant
   entry with that model's identity, zero usage, nothing billed, and no
   silent substitution. The reference `openrouter/<model>` is what the index
   stored, exactly as picked.
5. **Custom provider on a new protocol.** `my-mistral` was created on
   `mistral-conversations` (one of the two newly wired), with a hand-entered
   model. Creation 201; the probe against a deliberately dead local address
   reported "My Mistral could not be reached." - the connection surface is
   fully live on a protocol that was not among the four.
6. **Wrong key.** `openrouter-wrong` with a deliberately wrong key: the probe
   reports `ok: false`, "OpenRouter Wrong Key rejected the credential for
   this connection.", HTTP 401. The right-key connection still probes clean.
7. **A default for every slot.** All nine set in one session, including
   `videoGeneration` on the google connection (Veo declared there - one
   Google account serving chat and video) and `imageEditing` on
   `gemini-2.5-flash-image`. `GET /defaults` returns all nine. Which can be
   filled today: `textGeneration`, `webSearch`, `webFetch` (invoked); the
   other six are stored, listed, and awaiting their Studio tools.
8. **Remove a connection a conversation settled on.** A conversation was
   created pinned to `my-mistral/mistral-large-latest`; the connection was
   removed; the next send was refused with a 400 naming it: "No connected
   provider currently serves the model \"my-mistral/mistral-large-latest\".
   Check the picker or your connections." A refusal naming the missing
   provider, not a silent switch.

Live spend: one completed turn (nova-micro) and one provider-refused attempt
(zero usage). No loops, no benchmarks.

## 10. Verification

- `STUDIO HARNESS`: `pnpm typecheck` clean; `pnpm test` - **1332 passed /
  30 failed / 25 skipped** across 92 files. Every one of the 30 is the
  environmental refusal Task 37/38 recorded -
  `SandboxError: The sandbox needs one-time setup ... run: pnpm
  sandbox:prepare "C:\Users\pooki"` - in the sandbox-shaped files
  (`sandbox-appcontainer`, `mcp-launcher`, `tools/shell`, `mcp-flue`,
  `mcp-runtime`), re-run individually to confirm; the class is unchanged and
  none of the files touch provider code.
- `STUDIO`: `npm run typecheck` clean; `npm test` - **321 passed / 0 failed**
  across 28 files, zero unhandled errors.
- Rust untouched, so `cargo clippy` was not required.
- Both codebases were re-audited after the interruption that split this
  task's work: every changed and added file re-read, both typechecks and both
  suites re-run, the migration exercised against a copy of the real database
  and against fresh databases, and the working tree checked for stray temp
  files (none), smart punctuation (none in code; em dashes only in comment
  prose), or non-const casts added by this task.

## 11. Every place this brief was wrong, and what the work found

1. **"The settings pane" (singular).** There was no settings pane in the
   harness at all - the brief's "settings interface" spans two codebases and
   the harness's half is HTTP only. Part 0's inventory is the answer; the
   built interface is the webview folder.
2. **"OpenRouter answers 404: No endpoints found" implies probe-learning is
   free.** True, but the brief's two Part 6 options omitted the third
   problem found on the way: the wrong-key case probes green because the
   vendor's list endpoint is public. Probe-learning alone would have reported
   a broken connection as healthy; the public-list credential check is part
   of the Part 6 answer, not a separate feature.
3. **"The provider library - Pi's vendors plus our declared ones - findable."**
   The library did not exist as a surface: the add dialog's own docblock
   previously argued it could not be built because the vendor set "is not
   exposed over HTTP". `GET /api/providers/library` is that exposure, and the
   dialog's old reasoning is now false in exactly the way the old API-key
   reasoning became false in Task 38.
4. **"image editing is distinct from image generation"** - agreed, but the
   brief's slot list implied slots are free-floating; they are typed as
   `keyof ModelCapability`, so three new slots forced three new capability
   fields across both contracts, the Pi mapping, and every fixture. The
   "one place" derivation held; the place is bigger than the list.
5. **"Retrieval slots (search/reader) existed in `/api/providers/retrieval/*`"**
   - the brief never mentioned that web search and web fetch already had a
   selection system and a live consumer (`RetrievalService`, the native web
   tools). Adding webSearch/webFetch slots without unifying would have built
   a third system; the merged defaults now outrank the legacy keys at call
   time, with the legacy keys as read-only fallback.
6. **"`ManualModelInput` exists" - incomplete for the brief's own form.** The
   input carried capability, pricing, and shape but no reasoning levels, so
   the composer could never offer a hand-entered model's own dial. The input,
   the route schema, and the storage now carry `reasoningLevels`.
7. **The merge had a third tenant nobody named: retrieval.** Its keys share
   the `provider:` scope with the BYOK bridge, its routes predate the
   connection store, and its slots predate the defaults. The credential seam
   treats `provider:<vendor>` as the legacy location for both tenants, which
   is why the merge can be read-only about the keychain and still leave
   nothing orphaned.
8. **"A key that genuinely cannot be carried"** - on this machine there was
   no such key: all three legacy entries are api_key type, and the seam reads
   OAuth credentials for status even where it cannot present them. The honest
   state after the merge is the one the brief asked for as the fallback:
   a connection whose key cannot resolve reports `absent` and asks, it does
   not look broken.

One pre-existing wart preserved deliberately, again: `TurnMenu.tsx`'s
"Model library…" ellipsis character remains the user's committed copy; the
constraint applies to everything this task added.

## 12. On-demand implementation, after the report

Two pieces of work were requested after this report was first written. They
touch the task's own ground - the provider store, the catalog, the picker -
so they are documented here rather than in a file of their own. Neither
changes a contract the report above describes; both extend it.

### 12.1 Real provider icons, from models.dev

Every provider mark in the interface was a drawn shape: five brands from
simple-icons and a hand-drawn fallback for everything else. A catalog of
thirty-five authors made the fallback the common case, so the marks are now
the vendors' own.

The harness owns the whole pipeline, in `src/providers/icons/library.ts`:
the icon list comes from models.dev's `api.json` (fetched, parsed to id
strings, cached on disk under `cache/provider-icons`, refetched after a
24-hour TTL with a 60-second backoff after a failed fetch), and the icons
themselves come from `https://models.dev/logos/<id>.svg`, written next to the
manifest. Three properties the source forced:

- **The placeholder must be detected, not trusted.** models.dev answers HTTP
  200 with a generic 1421-byte SVG for an id it has never heard of. The
  library hashes every body it downloads and treats the known placeholder
  hash as "no icon", which is why a negative answer is as trustworthy as a
  positive one.
- **A vendor's public id is not always its logo's filename.** models.dev
  names its files after its own ids, so a small alias table bridges the
  difference (`mistralai` to `mistral`, `meta-llama` to `meta`,
  `together`/`together-ai` to `togetherai`, `fireworks` to `fireworks-ai`).
- **A broken network is not a negative.** A fetch that errors is remembered
  only as "ask again soon"; the mark falls back to the drawing for now and
  upgrades later, rather than being recorded as permanently unknown.

Answers travel one route, `GET /api/providers/icons/:id`: 200 with `{svg}`,
or 404 with `code: providers.icons.unknown` - absence is an ordinary answer,
carried the way every other absence in this task is carried. The webview
mirrors it (`parseProviderIcon`, `client.providerIcon`) and resolves through
`src/domain/providers/icons.ts`, a module-level cache that remembers
negatives exactly as firmly as successes - a row of two hundred models must
not re-ask for the vendors that have no logo on every render - and shares
one in-flight request per vendor. `ProviderMark` keeps its drawn mark as the
floor: it renders immediately, swaps to the real logo when one arrives, and
`data-provider` says the same thing whichever source is on screen.

### 12.2 The model picker, rebuilt as two surfaces

The picker had become the catalog: opening it against an aggregator
connection meant hundreds of rows in what used to be a shortcut. It is now
deliberately two surfaces.

The first level holds only what a decision needs: **Studio default** (the
harness's own default, still the resting choice - Studio is nobody's
first-party client and invents no model), **Recent** (the last three models
the user explicitly picked, most recent first), **Model library...** and
**Reasoning**. There is no "auto" mode; a recent is a recorded choice, not a
guess, and "Studio default" is deliberately never recorded into it. The
recents live in `src/domain/session/recents.ts` - three ids in localStorage,
deduplicated, capped, answered as empty when storage is corrupt or absent,
resolved against the live catalog at read time so a model that has since
been removed stops appearing instead of erroring.

The library is the second level: the full catalog grouped by connection
with a search field over the four names a row can be found by - display
name, provider id, author, connection name - and one door out,
"Add models in Settings...", because adding a model needs a page that can
hold a key and a wire format, not a menu.

Choosing inside the library is two steps: the model, then its reasoning
effort on the same dial the Reasoning entry uses, resting on Default -
leaving it alone is itself the choice "the provider decides". A model with
no reasoning support has no second step at all. Both steps write the same
index PATCH the old one-step picker wrote; nothing downstream changed.

The "Model library..." ellipsis character remains the user's committed copy,
carried verbatim into the rebuilt picker; the new settings item uses ASCII,
per the constraint the wart note above records.

### 12.3 Popover placement, three fixes found under the picker

Rebuilding the picker surfaced why its long lists misbehaved, and all three
defects were in the `Popover` primitive, not the picker:

- **The entry animation was being measured.** `getBoundingClientRect`
  reports the panel at its `scale(0.97)` entry transform, so an end-aligned
  menu - anchored to the window's right edge - was first placed a few pixels
  too far right, and the first reposition (any scroll does it) snapped it
  left. That is the "the UI shifts from right to left" seen on long lists:
  the shift only happens once something scrolls, and only a list long enough
  to scroll gets scrolled while open. Placement now measures
  `offsetWidth`/`offsetHeight`, which the transform never touches.
- **A menu that changes its own box kept its old position.** A view swapped
  inside an open menu, or a list shortened by a filter, changes the panel's
  size without any scroll or resize event to announce it. A guarded
  `ResizeObserver` on the panel re-places it when its content's size moves.
- **The clamp could be overpowered.** With a panel wider than the window,
  the min/max pair collapsed and let the panel hang off the right edge,
  giving the page a horizontal scrollbar. The bounds are floored, and the
  panel carries a CSS max-width backstop besides.

### 12.4 Verification

- STUDIO: 337 passed / 0 failed across 30 files, including 12 TurnMenu
  tests (states, the short first level, library grouping and search, the
  two-step PATCH, recents ordering, the cap, the two honesty cases, the
  dial), 6 recents tests, 4 ProviderMark tests, and 4 harness icon-library
  tests. Typecheck clean.
- STUDIO HARNESS: full suite re-run at the icons work's completion - 1336
  passed / 30 failed / 25 skipped, the 30 being the same environmental
  sandbox failures recorded in section 10, and typecheck clean. The picker
  work afterwards was webview-only; no harness contract changed.

### 12.5 The second on-demand pass: the library as a page, colour, and honesty

User testing of 12.2's picker found it wanting in four specific ways, and the
DB found something the tests had not: every pick that landed in the index had
come from the pre-rework picker, and both post-rework sends carried no model
at all. A two-step pick living inside a small popover was the failure mode -
the dial appeared where a row click used to be, and nothing said the pick
still needed finishing. The fixes below remove that failure mode rather than
patch it.

**The test model is gone.** The `openrouter-test` connection ("OpenRouter
test models") existed to host one hand-entered verification model,
`stealth/ox-alpha`, and nothing else - no defaults, no conversation, no
probe state pointed at it. `pnpm providers remove openrouter-test` removed
the connection and cascaded the manual model; the store is left with the two
real connections (google, openrouter).

**The pill tells the truth about its state.** With no model chosen it reads
"Choose a model", not a default dressed up as a selection; the resting
choice is still offered in the panel, named for what it is: "Default model".

**The library is a page now, not a popover.** "Model library..." opens a
dialog two thirds of the window wide: the list on the left - search over
name, provider id, author, and connection, grouped by connection with a
context-size hint per row - and the model's facts on the right: context
window, max output, input/output/cache prices per million tokens ("unknown"
shown as such, never as zero), capability chips, and the reasoning dial,
resting on Default. Choosing is explicit: a row click only highlights and
shows details; a button applies the pick and closes the page. Nothing can be
half-applied by a stray click, which is the failure the small popover could
not prevent. "Add models in Settings..." lives in the footer; adding is not
choosing.

**The logos wear their real colours.** Inspection showed every models.dev
logo is a monochrome `currentColor` SVG - dropped into an `<img>` they all
rendered black, which is what the user was looking at. The mark is now a CSS
mask and the fill is the vendor's own single-colour brand rendition, taken
from Simple Icons' official hex per brand (Google blue, DeepSeek blue,
Mistral orange, Meta blue, NVIDIA green, and the rest, in
`src/components/icons/brand-colors.ts`). A mask image cannot execute
anything, so the served SVG needs no sanitising. Two classes of vendor wear
the theme's foreground instead: those with no colour on file, and brands
whose colour is effectively black (Anthropic, Moonshot, GitHub Copilot) -
near-black on a dark theme is a mark nobody can see, and lightening a brand
into a colour it does not own is not the fix. The five drawn Simple Icons
marks take their brand colours too, by the same rule.

Verification: STUDIO 342 passed / 0 failed across 31 files - the picker
suite now walks the dialog path (13 tests), the mark suite asserts mask and
colour (5), and the colour table has its own (3) - with typecheck clean.
No harness code changed in this pass; the store change was the CLI removal
above, verified in the DB.

---

## 13. On-demand: images on a turn, and the media plan
After this report was closed, image upload shipped end-to-end (the webview
front half of Flue's own image payload: pick, rules, bytes on the submission,
thumbnails, vision refusal) and the media-generation roadmap was written. The
full research and plan live in `report/PLAN-media-and-images.md`; STUDIO is
now 355 passed / 0 failed across 32 files, typecheck clean, no harness code
changed (Flue already carried the whole image path).

---

## 14. On-demand: media foundation and dictation live (M1 + M2)

Requested as the concrete roadmap for speech, transcription, and generation:
only `studio_image` and `studio_video` are agent tools (a model asks for them);
dictation and read-aloud are app features — the person acts, not the model —
so they are plain routes, never permission-gated.

**Harness — the whole `src/media/` tree, one file per responsibility:**

| File | Owns |
| --- | --- |
| `src/contracts/media.ts:1` | `MediaError` (new `media` domain in `src/contracts/errors.ts:46`) and the two route schemas (`transcribeRequestSchema`, `speechRequestSchema`) |
| `src/net/http.ts:89` | Widened `body?: string \| Uint8Array` and a new `requestBinary()` reader — audio bytes stay bytes; the judge-pin-redirect security path untouched. The multipart uploads transcription needs are the first caller. |
| `src/media/multipart.ts:1` | The one multipart builder both transcription drivers share (binary parts, boundary, content-length). |
| `src/media/drivers/types.ts:1` | One result type per capability (`SpeechResult`, `TranscribeResult`); no god-interface. |
| `src/media/drivers/openai-speech.ts:1` | `POST {baseUrl}/audio/speech` → binary `audio/mpeg`, base64 on the way home. 120s budget; provider sentence relayed, key never echoed. |
| `src/media/drivers/openai-transcribe.ts:1` | `multipart POST {baseUrl}/audio/transcriptions` with `file=dictation.webm` (`audio/webm`) + `model`. 25 MB ceiling before the wire. |
| `src/media/resolve.ts:1` | The ONLY media module naming capability slots — wraps `CapabilityResolver.resolve(slot)` (`src/providers/capability-defaults.ts:73`) into `MediaBinding`. ElevenLabs named as "not yet served" rather than unknown. |
| `src/media/service.ts:1` | Dispatch + ceilings (4096 chars per speech call). Routes and the future tools both read here so the two halves cannot drift. |
| `src/transport/http/routes/media.ts:1` | `POST /api/media/transcribe` + `/speech` behind `ADMISSION_SCOPES.PROJECT` (`src/admission/scopes.ts:13`), the same scope the conversation surface uses. |
| `src/transport/http/create-app.ts:13` | Mounts `app.route("/api/media", createMediaRoutes(options.media))`; `CreateHttpAppOptions` gains `media: MediaAdministration`. |
| `src/app.ts:5` | Composition extracts one `ModelCatalog` (`src/providers/model-catalog.ts:1`) so `ProviderManagementService` and the new `MediaService` (via `CapabilityResolver`) read one truth. |

Error domain `media` added to `StudioErrorDomain` with four honest kinds:
`slot-unset` (no model connected — fix in Settings), `slot-protocol` (protocol not yet driven), `audio-too-large`, `provider-refused`.

**Webview — the mic button now speaks on the real model:**

| File | Change |
| --- | --- |
| `src/lib/base64.ts:1` | Shared `base64OfBytes()` — the same encoding the attachment path already spoke, now owned once (refactored out of `src/domain/attachments/images.ts:1`). |
| `src/platform/harness/client.ts:151` | `transcribe(audio)` + `speak(input)` on `HarnessClient`, each with a 150s per-call budget so the composer's round-trip sees the provider's answer, not a client timeout. Mirrored parsers use the same `isRecord` skepticism as every other `json()` caller (`src/platform/harness/client.ts:236`). |
| `src/features/voice/transcribe.ts:1` | The documented stub filled: `transcribeRecording(note)` resolves the harness address (`src/platform/harness/connection.ts:117`), builds `createHarnessClient(address)`, sends base64 audio; `TranscriptionOutcome` is `ok \| note` — a note is shown on the strip, never typed into the field. |
| `src/features/voice/speak.ts:1` | Twin seam for read-aloud (`speakText(text): SpeechOutcome`), same address resolution and `media.slot-unset` → human sentence mapping. |
| `src/features/voice/useDictation.ts:25` | `note: string \| null` state, self-clearing on the same `BLOCKED_DISMISS_MS` rhythm as mic-denied; `stop()` now awaits `TranscriptionOutcome` and either appends text or shows the note. |
| `src/features/voice/DictationBar.tsx:111` | `note` face on the blocked strip — `note` outranks `denied`, which is the correct priority (the mic worked, the words did not come back). |
| `src/features/settings/providers/DefaultsSection.tsx:44` | `INVOKED.transcription` → `true`; `PLACEHOLDER_BY_SLOT` for transcription cleared — dictation now invokes it, and the placeholder was the lie. |

**Verification:** `tests/unit/media-routes.test.ts:1` (7 tests) drives the real provider store through a fake OpenAI audio server on a real loopback socket — multipart bytes inspected, binary audio round-trips base64, unset slot refuses before the wire, provider refusals relay their sentence and never a key; `tests/unit/net-http.test.ts:99` gains the `requestBinary` bytes-as-bytes test; `src/features/voice/transcribe.test.ts:1` (2 tests) pins the two no-harness exits. STUDIO 357 passed / 0 failed (33 files); harness typecheck + `pnpm build` clean, the 30-failed sandbox baseline (`SandboxError: pnpm sandbox:prepare`) unchanged.

---

## 15. On-demand: one action row, fork, and read aloud (M3 UI)

Requested: one single version of the bubble actions — user bubbles copy-only, AI answers copy + branch + read aloud (no retry anywhere; a redone turn that touched a workspace is the person's call through git, not a button), and a working fork (whole-conversation via the sidebar 3-dot → **Fork**, and **Branch from here** under every finished answer, titled `<title> (Fork)`) plus a read-aloud pill that shows loading → player (pause/play, five bars that freeze on pause, close) with no timer.

**Flue has no branch API** (measured against the entire `@flue/runtime` 1.0.0-beta.9 surface — zero `fork`/`branch` in `dist/`, single-parent `parentId` chain, `FlueHarnessClient` in `src/application/harness-client.ts:38` exposing only `send/wait/cancel/history/observe`). The fork is therefore Path 1 from the plan: **transcript-seeded**, built from public seams only.

| File | Change |
| --- | --- |
| `src/features/chat/fork.ts:1` | `renderSeed()`, `turnsUpTo()`, `useForkConversation()` — `renderSeed` keeps roles legible to a model (`User:`/`Assistant:` between `--- transcript ---` fences); `turnsUpTo` takes the live projection (the same words on screen); `forkWhole` reads history once via `createConversationClient:attach` (`src/platform/harness/conversation.ts:307`) for the sidebar; wiring mints `newId('cnv')`, calls `startConversation()` (`src/features/chat/first-turn.ts:69`) with the source's settled settings (`effectiveTurnSettings(source, settings)`), patches the harness title through `createHarnessClient(address).updateConversation`, records locally with `beginConversation({title})`, and opens the new conversation. |
| `src/stores/workspace/WorkspaceProvider.tsx:187` | `beginConversation` gains optional `title?: string` — a fork's name is written through the rename path so it is manual and survives reloads/harness re-reads. |
| `src/features/voice/ReadAloud.tsx:1` | One control that grows into its player: idle `Icons.readAloud` → loading `WorkingDots` → pill (`pause`/`play` toggle `Icons.pause`/`Icons.play`, `VoiceBars`, `Icons.close`). `new Audio(data:audio/mpeg;base64,…)`, `onended` and unmount both cancel; error notes show for 3.2s then return the button. No clock — until the provider answers, nobody knows the length. |
| `src/features/voice/speak.ts:1` | Already landed in §14; unchanged here. |
| `src/components/icons/registry.tsx:139` | `play: CirclePlay`, `pause: CirclePause` — `Pause` already meant manual permission mode (`permissionManual: Pause`), so circled marks are used; the registry's `assertUnique` enforced it (the build's only failure before the fix). |
| `src/domain/attachments/images.ts:1` | `base64OfBytes` import update (shared lib). |
| `src/features/chat/transcript/MessageActions.tsx:28` | `after?: ReactNode` slot — the read-aloud pill renders between the icon buttons and the trailing caption, inside the same hover row and its `pointer-events-none` fade. |
| `src/features/chat/transcript/live/AssistantTurn.tsx:1` | Hover state, `writtenRuns()` helper, `actions=[branch]` when `onBranch` given, `after={<ReadAloud text={written}/>}`; docblock states the row's rule (branch + read aloud, no retry, no model name, withheld while live). |
| `src/features/chat/transcript/live/LiveTranscript.tsx:45` | `onBranch?: (messageId) => void` pass-through to `AssistantTurn`. |
| `src/features/chat/ChatPage.tsx:4` | Imports `useForkConversation`; `const {branchFrom}=useForkConversation()`; `<LiveTranscript onBranch={(id)=>void branchFrom(conversation, live.items, id)} />` — the source conversation's model is kept via `effectiveTurnSettings`. |
| `src/features/chat/transcript/live/LiveUserMessage.tsx:1` | Copy-only hover row (the live user protocol is the journal — no edit). |
| `src/features/chat/transcript/AssistantMessage.tsx:1` | Dropped `onRetry`/`retry` (`Icons.retry`) and the stub read-aloud; now `actions=[fork]`, `after={<ReadAloud/>}`, one version with the live row. |
| `src/features/chat/transcript/UserMessage.tsx:1` | Edit entirely removed (textarea, `onEdit`, `Icons.edit`, `Button` imports) — copy-only, same reasoning as the live row. |
| `src/features/chat/transcript/Transcript.tsx:1` | `onRetry` + `onEdit` props removed; demo `UserMessage`/`AssistantMessage` wired with the shared row only. |
| `src/stores/workspace/demo-turns.ts:21` | `LegacyTurns` loses `retry`/`editMessage`; demo fork title ` (fork)` → ` (Fork)` (capital F) to match harness forks; return `{run,cancel,send,fork}` only. |
| `src/stores/workspace/WorkspaceProvider.tsx:195` | `WorkspaceValue` loses `retry`/`editMessage`; value wiring updated. |
| `src/shell/sidebar/ConversationRow.tsx:4` | `useForkConversation()` + `MenuItem fork` (note: "A new conversation carrying everything said here.") — the whole-conversation fork is a sidebar verb, beside pin/rename. |
| `src/features/chat/transcript/live/LiveTranscript.test.tsx:121` | Silence tests rewritten: "nothing" now means "no caret, no claim" (`span.animate-pulse` + `Working`/`Thinking` text) rather than `querySelector('svg')` — the always-mounted hover rows are invisible until hovered, not claims. |
| `src/features/chat/transcript/live/AssistantTurn.test.tsx:76` | `finished` fixture now includes a `tools` segment to pin the skip; "offers nothing but copy" → "carries the three verbs: copy, branch, read aloud" + branch-click + withheld-without-fork case. |
| `src/features/chat/fork.test.ts:1` | 5 tests: `turnsUpTo` carries up to and including the named answer; `renderSeed` names the source, keeps roles legible, survives untitled. |

**What was deliberately not kept:** `Icons.edit` usage in `UserMessage` (the mark stays for conversation rename in the sidebar), `retry` mark stays in the registry (no collision), but the button, the wiring, and the store callbacks are gone on both surfaces — a button that answers a click with nothing is worse than no button, and the gallery is a display, not a conversation to retry.

**Verification:** STUDIO `npm run typecheck` clean; `npm test` — **365 passed / 0 failed across 34 files** (was 355 before this pass). Harness `pnpm typecheck` clean; `pnpm build` (`flue build --target node`) built `dist/server.mjs` with the media routes from §14 — no rebuild needed for this pass (webview-only), but the dist remains current. App restarted cleanly (harness ready, vite 200 — cold-boot stall on first launch after PC restart reproduced once, relaunch fixed it; see dev log).
