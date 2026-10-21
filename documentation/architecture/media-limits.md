# Pictures, attachments and documents: every limit, and why

Status: decided and implemented 2026-10-21, except where a row says
**planned**. Every value lives in one module per package -
`STUDIO HARNESS/src/contracts/media-limits.ts` and
`STUDIO/src/domain/attachments/limits.ts` - and `tests/unit/media-limits.test.ts`
(harness) fails when the client's turn limits drift from the harness's. Change
the module, this file, and (for turn limits) both packages together.

## 1. What the person can attach (client, checked at pick time)

| Limit | Value | Where |
|---|---|---|
| Images per turn | 5 | `limits.ts` `MAX_IMAGES_PER_TURN` (harness `TURN_MAX_IMAGES`) |
| Bytes per image | 10 MiB | `MAX_IMAGE_BYTES` (`TURN_IMAGE_MAX_BYTES`) |
| Total image bytes per turn | 15 MB | `MAX_IMAGE_BYTES_PER_TURN` (`TURN_IMAGES_TOTAL_MAX_BYTES`) |
| Image formats | PNG, JPEG, WebP, GIF (checked from the file header) | `images.ts` |
| Documents per turn | 5 | `MAX_DOCUMENTS_PER_TURN` (`TURN_MAX_DOCUMENTS`) |
| Bytes per document | 50 MiB | `MAX_DOCUMENT_BYTES` (`DOCUMENT_MAX_BYTES`) |
| Document upload time | 120 s | `STUDIO/src/platform/harness/client/documents.ts` `UPLOAD_BUDGET_MS` |

Why the total: 5 x 10 MiB is 66 MB once base64-encoded, more than twice the
largest request Anthropic accepts. The composer refuses the picture that
would pass 15 MB and says to send it with the next message.

## 2. What the harness accepts and does with it

| Limit | Value | Where |
|---|---|---|
| Base64 per image on a submission | 14 MiB of characters (about 10.5 MB raw) | Flue `MAX_IMAGE_DATA_LENGTH` (dependency) |
| Document file size | 50 MiB | `DOCUMENT_MAX_BYTES` |
| Spreadsheet rows / columns read | 5,000 / 1,024 | `SHEET_MAX_ROWS`, `SHEET_MAX_COLUMNS` |
| Document text inlined in the message | 40,000 characters; longer ones are read with `read` (`pages`) | `DOCUMENT_INLINE_CHARS` |
| Saved attachment file name | 120 characters | `ATTACHMENT_NAME_MAX_CHARS` |

Every attached image is also saved under the conversation's `attachments/`
folder, with its pixel size in the `attached_images` note, so the model can
`read` it again later.

## 3. What tools may add (read, media tools)

| Limit | Value | Where |
|---|---|---|
| Text file read | 1 MiB, 2,000 lines, 2,000 characters per line | `src/tools/filesystem/read.ts` |
| One picture from `read` or a media tool | 5,000,000 bytes | `TOOL_PICTURE_MAX_BYTES`, checked by `src/tools/filesystem/picture-size.ts` |

The per-conversation tool count (`ImageBudget`, 20 pictures and 15 MB since
harness start) was removed: it refused `read` of an old attachment once 20
pictures were shown, which is exactly how the window tells the model to get a
dropped picture back. The request window below decides what rides.

## 4. Screenshots (computer and browser tools)

| Limit | Value | Where |
|---|---|---|
| Encoded bytes per screenshot | 1,000,000; a PNG over it becomes JPEG, then shrinks | `SCREENSHOT_MAX_BYTES` |
| Longest side, screenshot / zoom | 1568 px | `SCREENSHOT_SIDE_PX` |
| Longest side, after-action picture | 1280 px | `AFTER_ACTION_SIDE_PX` |
| One MCP stdio message | 8 MiB; larger fails the request at once | `src/extend/mcp/wire/framing.ts` |

Why 1568: Anthropic scales any larger picture down to about this size before
the model sees it, so sending more costs upload time and adds no detail.
`zoom` gives full resolution for small text.

## 5. What one model request carries (the picture window)

Code: `STUDIO HARNESS/src/gateway/language/image-window.ts`, applied in both
stream paths of `local-adapter.ts`, to every provider and every picture source.

Decided rule:

1. Newest first. Keep pictures until the first of these is reached:
   - **50 pictures** (`REQUEST_MAX_PICTURES`);
   - **20 MB of base64** (`REQUEST_PICTURE_BASE64_CHARS`, about 15 MB of files);
   - pictures worth more than a quarter of the model's context window
     (`REQUEST_PICTURE_CONTEXT_SHARE`, at `PICTURE_TOKENS` = 1,600 each: a
     128k model carries 20).
2. Always kept: **every picture on the latest user message** and the newest
   picture.
3. More than 20 pictures (`MANY_PICTURES_THRESHOLD`) ride only when every one
   is at most 2000 px on each side; otherwise, or when a size cannot be read
   from its header, the request keeps to 20. Anthropic applies that rule to
   every picture in the request (on OpenRouter too) and rejects the whole
   request otherwise. Sizes come from the header (`src/documents/image-dimensions.ts`).
4. No gaps: once a picture is left out, every older one is too.
5. The cut moves in steps (`REQUEST_PICTURE_CUT_STEP` = 10; half the limit when the limit is small), so
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

## 7. Organisation

- Harness: `STUDIO HARNESS/src/contracts/media-limits.ts` holds every picture,
  attachment and document limit above with a one-line reason. Tools, the
  window and extractors import from it; there are no inline numbers.
- Client: `STUDIO/src/domain/attachments/limits.ts` holds the composer's.
  The packages cannot share code; `tests/unit/media-limits.test.ts` reads the
  client file and fails when a turn limit differs.
- Names say the unit: `_BYTES` raw bytes, `_BASE64_CHARS`, `_PX`, `_CHARS`.

Provider media adapters (`src/gateway/media/adapters/*`) keep their own
limits: those are each vendor's documented limits, belong with the vendor
code, and are already named constants.
