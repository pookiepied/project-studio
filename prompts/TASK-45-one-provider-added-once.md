# Task 45 - One provider, added once

The Add Provider list is flat: OpenRouter and Brave Search sit in the same
column, so nothing tells you what kind of thing you are adding. And
OpenRouter appears twice, because the data model says a provider is one kind
of thing when it is not.

Fix the model, then the list.

---

## Part 0 - The duplicate, confirmed before it is fixed

`listLibraryProviders()` (`src/providers/library/index.ts`) builds its result
in three loops. The language loop pushes `{ id: "openrouter", kind:
"language" }`; the image loop pushes `{ id: "openrouter", kind: "media" }`.
Nothing merges them.

Underneath that, `kind` is a property of the **connection** -
`ProviderConnection` is a discriminated union on it, and the credential key is
the connection id. So one OpenRouter account serving both chat and images
needs two connections, two ids, and **two keychain entries holding the same
key typed twice.**

Confirm both in the real code and say so in the report. Then note what else
is attached to the connection and should not be: **`protocol`**. OpenRouter
chat speaks `openai-completions`; OpenRouter images speak
`openrouter-images`. One account, two wire protocols. Pi's own model records
already carry `api` per model, which is where this belongs.

---

## Part 1 - The data model

**A connection is a vendor, an account, and a credential.** Nothing about
capability lives on it.

- `kind` comes off the connection. What a connection serves is a question
  about its models and its declared categories, answered by asking, never a
  field it carries.
- `protocol` moves to the model. A hand-declared endpoint that has no
  catalog still needs a default protocol somewhere; decide where and say why.
- `listLibraryProviders()` returns **one entry per provider**, carrying the
  categories it serves. Two loops producing two OpenRouters becomes one
  provider with two categories.

**Categories are declared by us, never derived.** This is the rule that
matters most and it is easy to get wrong: the catalog is a hint, not the
authority. Pi's catalog lists 35 OpenRouter image models, and Studio cannot
generate an image yet - so OpenRouter is not an Image provider until we have
built that path and said so. A maintained declaration is the cost of never
advertising a capability the product does not have.

The categories, and the slots each covers:

| Category | Slots |
|---|---|
| Chat | `textGeneration` |
| Image | `imageGeneration`, `imageEditing` |
| Video | `videoGeneration` |
| Audio | `speechGeneration`, `transcription` |
| Embeddings | `embeddings` |
| Search and fetch | `webSearch`, `webFetch` |

Nine slots, six categories, nothing left over. Declared in one place so a
tenth slot cannot be added without answering where it belongs.

**What is true today**, so the declaration starts honest rather than
aspirational:

- **Chat** - Pi, ten protocols. Works.
- **Audio** - our own drivers (`src/media/drivers/`), OpenAI's audio shape.
  Works. Pi has no audio API at all; verify that before you write it down.
- **Image** - Pi's `openrouter-images` catalog exists, invocation does not.
- **Video, Embeddings** - nothing.
- **Search and fetch** - keys can be stored, the MCP servers that would use
  them are Task 40.

A category we cannot invoke yet is declared as such and the interface says so
plainly. Do not quietly list it as working.

**Built-in provider tools earn nothing.** OpenAI ships a web search tool; we
do not use it. Web search and fetch are ours, through our own tools and the
search vendors connected for that purpose. OpenAI is a Chat provider, and an
Audio provider, and nothing else - regardless of what its API can do.

---

## Part 2 - The migration

Migration 17 or later; append only, never rewrite an applied one.

- Existing connections carry forward with the same ids and the same keychain
  entries. Nothing is retyped.
- A connection that held `kind` loses it without losing what it serves.
- If two connections exist today for one vendor because of the old model,
  say what happens to them. Merging silently is wrong; leaving both is
  defensible; ask the user is also defensible. Choose and defend it.

---

## Part 3 - Add Provider

**Categorised, never flat.** The dialog opens in a category and lists only
that category's providers. Switching category is a visible control. Brave
Search and OpenRouter are never in one column, because you are never looking
at both categories at once.

**One provider, added once.** OpenRouter appears under Chat and under Image.
Adding it from either place creates **one** connection with one credential.
Seen from the other category afterwards, it reads as already connected - not
as something to add again. This is the rule that kills the duplicate in
practice; everything else is presentation.

**Custom providers keep their place** in the flow, filed under the category
they serve.

---

## Part 4 - The Providers page

One page. It keeps its current jobs, including defaults - that part is not
the problem and should not be redesigned here.

What changes: providers are grouped by category rather than listed flat, and
one connection appears under every category it serves without being
duplicated. A provider's row says what it is connected for.

Defaults keep working across the change. Note in the report that a default
is a model for some slots and a provider for others - Chat resolves to
`claude-sonnet-4.5`, web search resolves to Tavily - and say how the code
expresses that difference.

---

## Explicitly not this task

The Studio MCP servers (Task 40). The settings navigation change (Task 41) -
expect it in the working tree and do not fight it. New categories. Any
change to what a pane's contents mean beyond the grouping above.

---

## Constraints

- Migrations are append-only, never rewritten.
- No `any`, no non-const `as`, no non-null `!`.
- The key is typed into the dialog, sent once, forgotten on unmount. Never in
  the Tauri store, localStorage, sessionStorage, a context outliving the
  dialog, a URL, or a log line. Never in a connection record or any response
  body - only `CredentialStatus` crosses. The credential never leaves Rust
  (ADR 0044).
- `~/.studio/` is the user's. Nothing deletes or moves anything under it on
  their behalf.
- UTF-8, no BOM, LF. Em dash in comment prose only; no en dashes, smart
  quotes, curly apostrophes, ellipsis characters, or emoji in source.
- Never leave a green placeholder test.
- Edit by hand, never with a script.
- Forbidden: `git checkout`, `git switch`, `git stash`, `git reset`,
  `git clean`, `git commit`, `git rebase`. `Backend/`, `docs/`, `prompts/`
  and `report/` are the user's - read, never modify, never `git add`.
- The working tree holds uncommitted work that is not yours. Change only what
  this task names.

## Verification

- `pnpm typecheck` in `STUDIO HARNESS`, `npm run typecheck` in `STUDIO`.
- Both vitest suites, one at a time, with counts. The sandbox-corridor
  failures are known and environmental; name anything else.
- The STUDIO suite reports zero unhandled errors as well as zero failures.
- Drive the built app: add OpenRouter from Chat, then open Image and show it
  reading as connected rather than addable. Screenshot both.
- Prove one connection and one keychain entry, not two.

## Report

`report/TASK-45-one-provider-added-once.md`:

- Part 0 confirmed, with the code that proves it.
- Where `protocol` went, and what a catalog-less endpoint does now.
- The declared category list, and which categories are honestly not
  invocable yet.
- What happened to duplicate connections from the old model.
- How a default expresses "a model here, a provider there".
- Screenshots.
- Every place this brief was wrong. Task 38's section 9 is the standard.
