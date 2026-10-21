# Pictures, attachments and documents: every limit, and why

Status: inventory as of 2026-10-21, with the decisions taken that day. Rows
marked **planned** are agreed but not yet in code. Update this file whenever a
limit changes; the code constants should point back here.

## 1. What the person can attach (client, checked at pick time)

| Limit | Value | Where |
|---|---|---|
| Images per turn | 5 | `STUDIO/src/domain/attachments/images.ts` `MAX_IMAGES_PER_TURN` |
| Bytes per image | 10 MiB | same file, `MAX_IMAGE_BYTES` |
| Image formats | PNG, JPEG, WebP, GIF (checked from the file header) | same file |
| Documents per turn | 5 | `STUDIO/src/domain/attachments/documents.ts` `MAX_DOCUMENTS_PER_TURN` |
| Bytes per document | 50 MiB | same file, `MAX_DOCUMENT_BYTES` |
| Document upload time | 120 s | `STUDIO/src/platform/harness/client/documents.ts` `UPLOAD_BUDGET_MS` |
| **planned** Total image bytes per turn | about 15 MB | composer, so one turn always fits Anthropic's 32 MB request |

Why the total is needed: 5 x 10 MiB is 66 MB once base64-encoded, more than
twice the largest request Anthropic accepts. Today such a turn reaches the
provider and fails there.

## 2. What the harness accepts and does with it

| Limit | Value | Where |
|---|---|---|
| Base64 per image on a submission | 14 MiB of characters (about 10.5 MB raw) | Flue `MAX_IMAGE_DATA_LENGTH` (dependency) |
| Document file size | 50 MiB | `src/documents/extract.ts` `MAX_DOCUMENT_BYTES` |
| Spreadsheet rows / columns read | 5,000 / 1,024 | `src/documents/extract.ts` |
| Document text inlined in the message | 40,000 characters; longer ones are read with `read` (`pages`) | `src/conversations/documents.ts` `INLINE_CHARS` |
| Saved attachment file name | 120 characters | `src/conversations/attachments.ts`, `documents.ts` (duplicated) |

Every attached image is also saved under the conversation's `attachments/`
folder, with its pixel size in the `attached_images` note, so the model can
`read` it again later.

## 3. What tools may add (read, media tools)

| Limit | Value | Where |
|---|---|---|
| Text file read | 1 MiB, 2,000 lines, 2,000 characters per line | `src/tools/filesystem/read.ts` |
| One picture from `read` or a media tool | 5,000,000 bytes | `src/tools/filesystem/image-budget.ts` `MAX_IMAGE_BYTES` |
| Pictures from tools per conversation | 20, and 15 MB, counted since harness start | same file, `ImageBudget` |

**Decision:** the per-conversation count (`ImageBudget`) is replaced by the
request window below. It predates the window, counts from harness start rather
than from the conversation, and refuses `read` of an old attachment once 20
pictures were shown, which is exactly how the window tells the model to get a
dropped picture back. Keep only the per-picture size check.

## 4. Screenshots (computer and browser tools)

| Limit | Value | Where |
|---|---|---|
| Encoded bytes per screenshot | 1,000,000; a PNG over it becomes JPEG, then shrinks | `src/computer/tools.ts`, `src/browser/tools.ts` `PICTURE_BUDGET_BYTES` (duplicated) |
| Longest side, screenshot / zoom | 1568 px | `src/computer/tools.ts` (inline `max: 1568`) |
| Longest side, after-action picture | 1280 px | `src/computer/tools.ts` (inline `max: 1280`) |
| One MCP stdio message | 8 MiB; larger fails the request at once | `src/extend/mcp/wire/framing.ts` |

Why 1568: Anthropic scales any larger picture down to about this size before
the model sees it, so sending more costs upload time and adds no detail.
`zoom` gives full resolution for small text.

## 5. What one model request carries (the picture window)

Code: `STUDIO HARNESS/src/gateway/language/image-window.ts`, applied in both
stream paths of `local-adapter.ts`, to every provider and every picture source.

Decided rule:

1. Newest first. Keep pictures until the first of these is reached:
   - **50 pictures** (planned; 20 today);
   - **20 MB of base64** (about 15 MB of files);
   - **planned:** pictures worth more than a quarter of the model's context
     window (a screenshot is about 1.5k tokens).
2. Always kept: **every picture on the latest user message** (planned; today a
   large upload could lose one of its own pictures) and the newest picture.
3. **Planned:** beyond the newest 20, a picture rides only if both sides are at
   most 2000 px. Anthropic applies that rule to every picture once a request
   holds more than 20 (on OpenRouter too) and rejects the whole request
   otherwise. Sizes come from the file header (`src/documents/image-dimensions.ts`).
4. No gaps: once a picture is left out, every older one is too.
5. The cut moves in steps (10; half the limit when the limit is small), so
   the start of the request, which providers cache, changes once per step of new
   pictures, never every turn. Under the limit nothing is cut.
6. A left-out picture becomes one line of text saying how to get it back.
   The transcript is never changed and nothing is compacted.
7. **Planned:** an optional "max pictures per request" per model in the model
   library, set by the person, for routes with a lower limit.

Rejected on 2026-10-21:

- **Learning the limit from provider errors** and retrying: too ambiguous
  (OpenRouter can route each request to a different server; error wording
  varies). A refusal reaches the person as it does today.
- **A per-provider table:** Studio sees "openrouter", not the server behind it.
- **Downscaling in the harness:** needs an image decoder; providers already
  downscale; it would make small text harder to read.

## 6. Provider facts these numbers rest on (checked 2026-10-21)

| Provider / route | Pictures per request | Other |
|---|---|---|
| Anthropic API (also via OpenRouter) | 100 (200k-context models), 600 others | 32 MB request; 10 MB base64 per picture; over 20 pictures, every picture must be at most 2000 px |
| Azure GPT-5.1 | 50 | |
| Some Azure deployments | 10 | |
| OpenRouter routes seen in user reports | 4 (DeepInfra), 8, 20, about 33 (GLM) | errors are passed through from the server behind |

Sources: Anthropic vision docs (platform.claude.com/docs/en/build-with-claude/vision);
Microsoft Q&A threads on Azure image caps; GitHub issues earendil-works/pi#10131,
Kilo-Org/kilocode#720, harmoniqs/opencode#377; anthropics/claude-code#2752.

## 7. Organisation (decided)

Limits are spread over many files, some duplicated with the same name and
different meanings (`MAX_IMAGE_BYTES` is 10 MiB in the client and 5 MB in the
harness tool path), and three screenshot sizes are inline numbers. Planned:

- Harness: one module, `STUDIO HARNESS/src/contracts/media-limits.ts`, holding
  every picture, attachment and document limit above with a one-line reason
  and a pointer to this file. Tools, the window and extractors import from it;
  no inline numbers.
- Client: one module, `STUDIO/src/domain/attachments/limits.ts`, for the
  composer's limits. The two packages cannot share code, so values that must
  agree are checked by a test on each side against this table.
- Names say the unit and the scope: `..._BYTES` raw bytes, `..._BASE64_CHARS`,
  `..._PER_TURN`, `..._PER_REQUEST`, `..._PX`.

Provider media adapters (`src/gateway/media/adapters/*`) keep their own
limits: those are each vendor's documented limits, belong with the vendor
code, and are already named constants.
