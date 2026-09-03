# Task 44 - An image the agent can make

The harness can search the web, read a page, speak, and listen. It cannot make
a picture. The provider store already has `imageGeneration` and `imageEditing`
slots, the model catalog already lists image models, and the Providers pane
already lets a user set a default - and nothing on the other end ever asks.

Close that. Harness only. The webview is being worked on in the same tree by
someone else; touch none of it.

---

## Part 0 - Read what already works, and copy it

Two shapes exist in this repo and this task must not invent a third.

**The web tools** (`src/tools/web/`, joined in `src/tools/native/index.ts`)
show how a capability slot reaches a tool. `MergedRetrievalResolver`
(`src/providers/capability-defaults.ts`) resolves the `webSearch` / `webFetch`
slot to a vendor and a key; the tool takes a narrow link interface, not the
store, and the join is a small function in `native/index.ts` that returns
`undefined` when the store is unavailable so the tool still works.

**The media drivers** (`src/media/drivers/openai-speech.ts`,
`openai-transcribe.ts`, `types.ts`, `service.ts`, `resolve.ts`) show how we
call a provider ourselves over plain HTTP when Pi has no API for it.

Read all of it first. State in the report which of the two shapes image
generation belongs to and why. My reading is that it is both - a media driver
underneath, a native tool on top - but prove it rather than take it.

**Also settle a question of fact before building.** Pi ships an
`openrouter-images` API (`dist/api/`, `dist/image-models.js`) and the image
catalog in `src/providers/library/image-catalog.ts` reads it. Decide whether
we invoke images through Pi or through our own driver, measure what Pi's image
path actually accepts and returns, and defend the choice. Do not assume the
speech drivers' answer applies here; speech drivers exist because Pi has no
audio API at all, and that reason does not hold for images.

---

## Part 1 - Generating

A native tool that turns a description into an image.

- The model asks for a picture. It does not name a vendor and no vendor name
  appears in its schema - ADR 0023 §1, the same rule the web tools follow.
  Read `WEB_SEARCH_DESCRIPTOR` and match its restraint.
- Which provider answers comes from the `imageGeneration` slot. Unset is a
  first-class answer: the tool refuses with a sentence naming the fix, the way
  a missing transcription model already does. It never silently picks one.
- The credential chain is the connection's own key, then the vendor's legacy
  entry, exactly as `MergedRetrievalResolver.keyFor` does. Do not write a
  third credential path.

## Part 2 - Where the bytes go

An image is large and binary, and this is the part most likely to be got
wrong, so decide it deliberately and write the decision down.

- A tool result is text in a transcript. The image itself is not. Decide where
  the file lands - the conversation's `artifacts` directory is the obvious
  candidate and already exists per conversation (Task 37) - and what the tool
  returns so the transcript stays readable and the file stays findable.
- Nothing under `~/.studio/` is deleted or moved on the user's behalf. A
  second generation does not overwrite the first.
- Say what happens for a projectless conversation versus one in a project.

## Part 3 - Editing, or an honest refusal

`imageEditing` is a separate slot. Either build it in the same pass, or state
plainly in the report that it is not built and that the slot is still unread -
and if so, make sure nothing in the harness claims otherwise.

Choose on evidence: if the provider path you picked in Part 0 supports editing
with a small addition, build it. If it needs a different request shape, a
different catalog, or image upload plumbing that does not exist, defer it and
say exactly what is missing.

## Part 4 - Failure that says what to do

Every refusal names its fix in one sentence, in the voice the media service
already uses. The four that matter: no default set, the provider has no
credential, the provider rejected the request, and the request timed out. A
vendor's raw error body is never returned verbatim to the model.

Deadlines: the web tools use 45s. Image generation is slower. Pick a deadline
from what the provider actually takes and justify the number.

---

## Explicitly not this task

Video. Any webview or `STUDIO/` file. The provider taxonomy change (Task 45) -
read the slots as they are today. New capability slots. Displaying the image
anywhere.

---

## Constraints

- No `any`, no non-const `as`, no non-null `!`.
- Keys never appear in a response body, a log line, an error, a test fixture,
  or the report. Only `CredentialStatus` crosses a boundary.
- `~/.studio/` is the user's. Nothing deletes or moves anything under it.
- Migrations are append-only, never rewritten.
- UTF-8, no BOM, LF. Em dash in comment prose only; no en dashes, smart
  quotes, curly apostrophes, ellipsis characters, or emoji in source.
- Never leave a green placeholder test.
- Edit by hand, never with a script.
- Forbidden: `git checkout`, `git switch`, `git stash`, `git reset`,
  `git clean`, `git commit`, `git rebase`. `Backend/`, `docs/`, `prompts/`
  and `report/` are the user's - read, never modify, never `git add`.
- The working tree holds a lot of uncommitted work that is not yours, and
  active frontend work in `STUDIO/`. Change only what this task names.

## Verification

- `pnpm typecheck` in `STUDIO HARNESS`, clean.
- The harness vitest suite, with counts. The sandbox-corridor failures are
  known and environmental; name anything else.
- Drive the real thing: set an `imageGeneration` default, call the tool
  through the gate, and show the file that appeared on disk with its size.
- Show the refusal when no default is set.
- If a live call spends the user's money, make exactly one, at the smallest
  size the provider offers, and never loop it.

## Report

`report/TASK-44-an-image-the-agent-can-make.md`:

- Pi's image path or our own driver, and the measurement behind the choice.
- Where the bytes land and what the tool returns.
- Whether editing was built, or exactly what is missing.
- The deadline and why that number.
- The four refusals, quoted.
- Every place this brief was wrong. Task 38's section 9 is the standard.
