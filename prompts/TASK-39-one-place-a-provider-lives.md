# Task 39 - One place a provider lives

Build the provider system: one store, a capability-aware catalog, and the
settings interface over it, in the harness and in the webview both.

Read `report/TASK-38-the-model-the-user-actually-picked.md` sections 1, 2 and
9 first. They are accurate.

---

## The model this is built on

**A provider is a source. A capability is a tag on a model.** OpenAI is one
provider that serves chat, transcription and speech. OpenRouter is one
provider that serves chat and images. Splitting providers by capability would
make the user connect the same account three times. So: connect a provider
once, and its models arrive already tagged with what each can do.

**What Pi's catalog actually gives us** (measured, not assumed):

- 1072 language models across 35 providers, all chat protocols.
- 35 image models, OpenRouter only, in a **separate** catalog reached through
  `dist/image-models.js` (`getImageProviders` / `getImageModels`).
- **Nothing** for video, speech-to-text, text-to-speech, web search, or web
  fetch.

So the catalog has three sources, not one: Pi's language catalog, Pi's image
catalog, and **our own declared catalog** for everything Pi does not know.
That third one is a file we write and maintain, and it is where Whisper,
ElevenLabs, Veo, Tavily, Brave, Exa, Jina and the rest are declared. Verify
these numbers yourself before building on them.

**Language runs through Pi. Nothing else does.** Image, video, speech and
retrieval are invoked by **Studio's own MCP servers** - `studio-image`,
`studio-video`, `studio-web-search`, `studio-web-fetch` - which read the
provider settings to learn which provider and model the user chose for that
capability. Those servers are Task 40. This task builds everything they will
read, and leaves that seam deliberately.

---

## Part 0 - Two provider systems, settled first

Task 38 found them. They do not know about each other:

- **Settings world**: `provider_connection_record` (`ConnectionStore`),
  `ModelCatalog`, `GET /api/providers/*`, the Settings pane, the Task 38
  picker. Zero rows on the user's machine.
- **Runtime world**: `custom_provider` plus `app_setting`'s `local.*` keys,
  via `ProviderSettingsStore`, wired in `models/bootstrap.ts`, written by
  `pnpm providers`, read by `LocalModelProviderAdapter` when a turn goes out.
  This holds the user's real OpenRouter connection.

Establish, from real code and the user's real database: every reader and
writer of each; what each can express that the other cannot; **where each
keys its keychain entry** (carrying a row without its key silently
disconnects a working provider); and the real row counts. The merge direction
follows from that data.

## Part 1 - One store

Merge them in the direction Part 0 supports.

- Migrations are append-only; 16 or later. Carrying rows forward is expected;
  dropping the old table in the same release is not.
- No user data lost, no credential orphaned. A connection that works before
  works after, same key, nothing retyped. A key that genuinely cannot be
  carried leaves the connection asking for one, not looking broken.
- `pnpm providers` writes the merged store or is retired deliberately, with
  the reason. It must not keep writing a store nothing reads.
- Task 38's `<provider>/<model>` reference and the stable alias keep working.

---

## Part 2 - `src/providers/`, modular

This is the folder the whole system lives in, and it must not become one
large file. Separate concerns get separate modules - at least these, named
for what they own:

- **the built-in catalog** - reading Pi's language models, reading Pi's image
  models, and our own declared catalog for the capabilities Pi has none of.
  Three sources, one shape out, each in its own file.
- **connections** - the store, the probe, the credential seam.
- **model editing** - manual models, overrides, hiding, capability
  declaration. Adding a model to an existing provider is its own concern and
  its own file.
- **capability selection and defaults** - which model fills each slot.
- **the HTTP surface** - routes only, no policy.

Same discipline in the webview: the settings surface is a folder of focused
components, not one pane that grew.

---

## Part 3 - Capabilities and defaults

`CAPABILITY_SLOTS` (`contracts/providers.ts:279`) is six today:
`textGeneration`, `imageGeneration`, `videoGeneration`, `speechGeneration`,
`transcription`, `embeddings`. The product needs more: **image editing** is
distinct from image generation, and **web search** and **web fetch** are
distinct from each other. Extend the list; it is derived in one place, so
adding a slot is a contract change and nothing else.

Every slot gets a user-chosen default: which model answers chat, makes an
image, edits an image, makes a video, speaks, transcribes, embeds, searches
the web, fetches a page. `getDefaults`/`setDefault` already exist.

A slot with nothing connected says what would have to be connected to fill
it. A slot whose default vanished says that, and never silently falls back.

---

## Part 4 - The settings interface

**Connect.** The provider library - Pi's vendors plus our declared ones -
findable, each showing which capabilities it serves. Pick one, type a key
(optional where the protocol allows), probe, and report what the probe
actually learned: how many models, or the provider's own error sentence.

**Custom providers, first class**: display name, base URL, protocol, optional
key. `src/models/local/apis.ts` wires 4 of Pi's 10 language protocols - wire
the rest or name precisely which cannot be, and why.

**The model library.** After a probe, models are shown for explicit selection
with Select All; what is selected is what the rest of the product offers.
Searchable, with each row's capabilities, context window and price. `unknown`
reads as unknown, never as a missing tick.

**Add a model to an existing provider.** A model the catalog has never heard
of, under a library provider. `ManualModelInput` exists
(`providers/model-catalog.ts:68`). The form: display name, slug, input
modalities, **capabilities chosen explicitly** against
`modelCapabilitySchema`'s real fields, and **reasoning levels** for a model
that reasons - that model's own levels, from `reasoningLevels`, not a fixed
dial. What the user ticks here is what the product then does or refuses.

**Edit and remove.** A manual model can be corrected, a catalog model hidden.
`setModelOverride` and `removeModel` exist; give them a surface.

**Icons.** OpenRouter's mark on the connection, Anthropic's mark on the model
in chat. Two facts, two places, never one painted twice.

---

## Part 5 - Where the runtime does not exist yet

Language turns work end to end. Image, video, speech and retrieval have no
invocation path until Task 40's MCP servers.

They still get the **whole** surface: connect, store the key, list and select
models, choose the slot default. The one honest sentence goes exactly where
the invocation would be. A placeholder is not a greyed-out menu item; it is
everything working up to the missing piece, and a plain sentence there.

Leave the seam Task 40 reads: a settled way to ask "which provider and model
did the user choose for this capability, and what is its credential", usable
from an MCP server. Name it in the report.

---

## Part 6 - Stale catalog rows

Task 38 found `ai21/jamba-large-1.7` offered while OpenRouter answers
`404: No endpoints found`. Choose one: the probe learns what the connection
can actually serve and only those are selectable, or a model that 404s is
marked unavailable where the user sees it. Not both, not neither.

---

## Part 7 - Person verification

You, driving the built app. Screenshots where a screen is the deliverable.

1. Before and after the merge: which provider does this machine send turns
   through, and what does Settings show?
2. Connect a language provider, select a subset of models, send one short
   turn on one of them.
3. Connect a provider for **transcription or speech**, one for **image**, one
   for **web search**. How far does each get, and where exactly does it stop?
4. Add a custom model under a library provider with capabilities and
   reasoning levels chosen by hand. Does the composer offer it, and does a
   turn on it reach the wire correctly?
5. Connect a custom provider on a protocol that was not among the four.
6. Wrong key: what does the probe say?
7. Set a default for every slot. Which ones can be filled today?
8. Remove a connection a conversation had settled on. A refusal naming the
   missing provider is correct; a silent switch is not.

Live turns spend the user's money: one short message each, never looped. The
key never appears in a log, error, fixture, screenshot, test, or report -
check the screenshots specifically.

---

## Explicitly not this task

The Studio MCP servers themselves (Task 40). Image input in the composer and
its gating. Permission modes. Project sandbox binding.

---

## Constraints

- Migrations are append-only, never rewritten.
- No `any`, no non-const `as`, no non-null `!`.
- The key is typed into the dialog, sent once, forgotten on unmount. Never in
  the Tauri store, localStorage, sessionStorage, a context outliving the
  dialog, a URL, or a log line. Never in a connection record or any response
  body - only `CredentialStatus` crosses. Secrets live in the OS credential
  store; `assertNoSecretColumns` guards column names; the valibot parse on
  the write path is never removed. The credential never leaves Rust (ADR
  0044).
- `~/.studio/` is the user's. Nothing deletes or moves anything under it on
  their behalf.
- UTF-8, no BOM, LF. Em dash in comment prose only; no en dashes, smart
  quotes, curly apostrophes, ellipsis characters, or emoji in source.
- Never leave a green placeholder test. A placeholder screen is a
  deliverable; a placeholder test is a lie.
- Edit by hand, never with a script.
- Forbidden: `git checkout`, `git switch`, `git stash`, `git reset`,
  `git clean`, `git commit`, `git rebase`. `Backend/`, `docs/`, `prompts/`
  and `report/` are the user's - read, never modify, never `git add`.

## Verification

- `pnpm typecheck` in `STUDIO HARNESS`, `npm run typecheck` in `STUDIO`.
- Both vitest suites, one at a time, with counts. Name any failure you did
  not cause; the sandbox-corridor class is known and environmental. The
  STUDIO suite reports zero unhandled errors as well as zero failures.
- `cargo clippy --all-targets` clean if you touch Rust.

## Report

`report/TASK-39-one-place-a-provider-lives.md`:

- Part 0's inventory: readers, writers, real row counts, both keychain key
  formats.
- The merge direction and every field that did not survive it.
- What happened to `pnpm providers`.
- The three catalog sources, verified counts, and what our own declared
  catalog covers.
- The folder layout, and why each module owns what it owns.
- Which protocols are wired, which are named unreachable and why.
- Where each capability's placeholder begins, and the seam Task 40 will read.
- Part 6's choice and its cost.
- The eight Part 7 observations, with screenshots. Name what you could not
  run.
- A section for every place this brief was wrong. Task 38's section 9 is the
  standard.
