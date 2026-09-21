# Library — the brief

**Status:** Built · **Opened:** 2026-09-22 · **Landed:** 2026-09-22
What landed, and where it differs from the plan, is in §6 at the end.

The captured version of a spoken brief, checked against the code. The open
choices were taken as recommended: the library lives under the Studio home,
and a vision model proposes a description and tags when an image is saved.

---

## 1. The problem, in one paragraph

Everything a person gives Studio belongs to one conversation. An uploaded
picture rides on its message and is copied into that conversation's
`attachments/` folder; a generated picture lands in its `artifacts/` folder.
Neither survives the conversation, neither can be found from another one,
and nothing records what a file is — whose face it is, what it shows, why it
was kept. The brief asks for a library: one durable place where a person
chooses to keep a file, says what it is in their own words ("this is me",
"the company logo"), and can find it again — in Settings, and from any
conversation, by asking the model. The model must then be able to use what
it finds: hand a kept photo to `studio_image`, read a kept document. The
brief names ChatGPT's library and Hermes Agent's as the shape it wants, and
says explicitly that this is tagging, not face recognition.

## 2. What exists today

- `conversations/attachments.ts` copies each delivered image under its own
  name into `data/conversations/<id>/attachments/`. That folder and
  `artifacts/` are read roots of the conversation's sandbox, and the
  environment note names them. Nothing lists what is in them.
- The composer accepts images only (PNG, JPEG, WebP, GIF, 10 MB each, five a
  turn). There is no document upload, so "any sort of attachment" today
  means pictures; the library must not inherit that limit.
- `studio_image` takes `input_paths` resolved through the sandbox's read
  roots, and the `read` tool returns a picture as an image block when the
  model can see one. So the model can already work on a file it can reach;
  what is missing is the reach and the finding.
- `agents/improve.ts` with `application/text-improver.ts` is the pattern for
  a one-shot model call from a route: dispatch an agent under a fresh id,
  wait for its one reply on the observation bus, parse a JSON object.
- Settings has a pane pattern (`useCommands` → `CommandsPane`, harness
  client + contracts + barrels) and a section list with an Account group.
- `durableDirectories()` is what backup enumerates; a new folder under
  `data/` is covered by construction.

## 3. The design

### 3.1 One folder, one table

`~/.studio/data/library/` holds the files, flat, each under its record id
plus the original extension (`lib_<uuid>.png`). A flat folder by id means a
renamed or re-tagged item never moves, two uploads called `photo.png` never
collide, and a future kind needs no new folder rule.

The record is a row in a new SQLite table `library_item`:

| column | meaning |
| --- | --- |
| `id` | `lib_<uuid>` |
| `kind` | `image` today, `document` today, anything later — decided from the mime |
| `file_name` | the name the person's device gave it |
| `mime_type` | as sniffed or declared |
| `byte_length` | for the pane and for budgets |
| `title` | short, the person's or the model's |
| `description` | one or two sentences |
| `subject` | who or what it is, in the person's words: "me", "Bruno", "logo" |
| `tags` | JSON array of lower-case words |
| `source_conversation_id` | where it came from, or null for a direct upload |
| `created_at` | epoch ms |

Search is a `LIKE` over title, description, subject, tags and file name.
The library is personal and a few hundred items at most; a full-text index
is a later problem.

### 3.2 Two ways in

1. **From the composer.** Each pending image gets a "Keep" control on its
   thumbnail. Clicking it opens the item dialog with the picture, and the
   dialog asks the model for a description and tags while the person types
   the subject. Saving does not touch the message: the picture still rides
   on the turn as it always did, and the library holds its own copy.
   A picture already sent can be kept later from its message in the
   transcript, and a generated picture from its artifact card, both through
   the same dialog.
2. **From the Library page.** An "Add files" button takes any file: images
   go through the same dialog, other kinds skip the model and take a title
   and tags directly.

Nothing is saved without the person's yes. That is the prompt the brief
asks for: not a modal on every upload, but a visible offer on each one.

### 3.3 Describing an image

A new `describe` agent (`agents/describe.ts`, the shape of `improve`) runs
once per save on the person's default model, with the image attached and a
fixed prompt that asks for `{ "title", "description", "tags" }` — nothing
about identity. The prompt tells the model to describe what is visible
and never to guess who a person is; the subject field is the person's
alone. The route (`POST /api/library/describe`) answers with the proposal
or with "the model could not describe this", and the dialog works either
way. The default model is the one the person already talks to, so the
image goes nowhere it would not go in a message; the dialog says so in one
line.

### 3.4 Finding and using from a conversation

- `library_search` is a native tool: `query`, `kind`, `subject`, `tag`, at
  most 20 results, each with id, kind, title, subject, tags, file name and
  the absolute path. Its description tells the model that a person's
  "my photo", "our logo", "the contract" is a library question first.
- The library folder is a read root of every conversation's sandbox, so
  the path a result carries can be handed to `studio_image` or `read`
  straight away. Read only: the harness writes the folder, the model does
  not.
- The environment note gains one paragraph naming the folder and the tool,
  and saying what the path is for: reading. A kept item is a reference for
  the conversation - a photo the model looks at and discusses, a document
  it reads and works from - and only sometimes an input for generation.
  `read` already returns a picture to a vision model and the text of a
  text file; this cut adds PDF text extraction to `read` so a kept PDF is
  working material too. Word and similar formats are a later cut.
- `library_keep` is a second, small tool for "keep this" said in a chat:
  it files a workspace or artifact path with a title, subject and tags.
  The kernel treats it as a command, so it asks in Ask mode.

### 3.5 The Settings page

Under Account: **Library**. A grid of items with thumbnails for images and
a kind mark for the rest; a search box; filters by kind and subject;
each card opens the item dialog to edit title, subject, tags and
description, or delete. "Add files" and "Open folder" at the top.

## 4. Not in this cut

Face recognition; saving every upload without asking; document text
extraction for search; syncing the library between devices; a per-item
"use in this conversation" button (the model's search covers it).

## 5. Build order

1. Harness: paths, migration, `LibraryStore`, unit tests.
2. Harness: `describe` agent + `ImageDescriber`; routes under `/api/library`
   (list, get, bytes, add, update, delete, describe).
3. Harness: `library_search` and `library_keep` tools, the read root, the
   environment paragraph; tests.
4. Frontend: contracts, client, `useLibrary`, the item dialog, the
   composer "Keep" control, the transcript and artifact-card actions, the
   Settings page.
5. Checks, live check, merge.

## 6. What landed

Everything in §3 and §5, with these differences from the plan:

- **Keeping a picture already sent** is not in this cut. A sent message's
  attachment view carries no id the webview could fetch bytes by, so the
  transcript offers Keep on generated pictures (the artifact card) and the
  composer offers it on every pending upload; a picture that was sent
  without being kept can be added again from Settings > Library.
- **PDFs read as text.** `read` extracts a PDF's pages with `unpdf`
  (loaded on first use), numbered and paged like any text file, up to
  40 MB; a scanned PDF says it has no text. This replaced the old flat
  refusal, because a kept document the model could not open would have
  made the library a shelf of pictures.
- **The system prompt** gained a Library section naming both tools, beside
  the environment paragraph that names the folder; the prompt's tool
  scan requires every native tool to be listed.
- The library is served under the `project` admission scope, like media;
  the describer answers 502 when the model fails and the dialog carries
  on without a proposal.
- "Open folder" is a path shown under the grid, not a button: nothing in
  the webview opens a folder today.
