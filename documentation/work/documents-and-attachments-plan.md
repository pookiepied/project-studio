# Documents and attachments — the plan

**Status:** Built (first cut) · **Opened:** 2026-09-22 · **Landed:** 2026-09-22
What landed, and where it differs from the plan, is in §11 at the end.

Captured from a spoken brief, checked against the code and against how
Hermes Agent (NousResearch) does the same job. Two things live here: the
plan for document attachments (PDF and the rest), and a parked concern
about attachment storage that is deliberately not part of the first cut.

---

## 1. The hard fact that shapes everything

The engine under Studio (Flue 2.0.3 on pi-ai) models message content as
`text` and `image` only. There is no document or file block. So a PDF can
never be handed to a provider as a native document; every document has to
become text and/or page images on the harness side before it reaches the
model. This is also true of Hermes: its own note says "a PDF must never
become a vision part" (`agent/image_routing.py`), and documents are saved
to a cache and read through the file tools.

That is acceptable. It gives the harness full control over what enters the
context, which is what the token concern needs.

## 2. Where things stand today

- The composer accepts images only (`STUDIO/src/features/chat/composer/Composer.tsx`,
  `accept="image/png,image/jpeg,image/webp,image/gif"`, 10 MB each, five a turn).
- The `read` tool extracts a PDF's text with `unpdf` (`STUDIO HARNESS/src/tools/filesystem/read.ts`,
  up to 40 MB). A scanned PDF says it has no text. Nothing renders pages.
- The library takes any mime up to 50 MB and calls PDF, text, JSON, Office and
  EPUB "document" (`STUDIO HARNESS/src/library/store.ts`, `kindOfMime`).
- Delivered images are copied into `data/conversations/<id>/attachments/`
  (`STUDIO HARNESS/src/conversations/attachments.ts`).

## 3. What Hermes Agent does (the pattern to borrow)

Read from a clone of `NousResearch/hermes-agent` on 2026-09-22.

- **Inbound documents are never inlined by default.** The gateway saves the
  file to a document cache and prepends a note to the user turn:
  "The user sent a document X. It is saved at PATH. Its text is not inlined
  here. Extract it yourself before answering, instead of asking the user to
  paste it." Small `text/*` files are the one exception: their content is
  inlined and the path is still given. (`gateway/run.py`,
  `_build_document_context_note`.)
- **`read_file` converts documents in place.** A read of a `.pdf`, `.docx`,
  `.xlsx`, `.pptx`, `.epub`, `.rtf` returns paginated, line-numbered text
  under a character budget (about 25–35k tokens, configurable), with
  `next_offset` for continuing. (`tools/read_extract.py`, `tools/file_tools.py`.)
- **Scanned pages are detected per page and reported, not hidden.** Text is
  counted per page (`pdftotext`, form-feed split, fewer than 20 chars means
  empty). If enough pages are empty (2 pages and 20 %, or 10 pages
  absolute), a note is *prepended* to the text: "NEEDS OCR: pages 3, 4, 7
  are scanned images with no text layer — their content is MISSING below."
  Prepended, not appended, because paginated reads may never fetch a footer.
- **OCR is a tiered escalation, never the default.**
  1. Text layer (free).
  2. Hosted OCR, only when the user configured a route; tried automatically
     when the whole document is scans, and its failure is reported in the
     same note.
  3. Otherwise the note tells the model how to recover on its own: render
     just the missing pages (`pdftoppm -r 150 -f N -l N`) and look at them
     with `vision_analyze`, or check for an OCR skill.
  4. A `pdf` skill documents the heavy path (marker-pdf, 3–5 GB, real OCR,
     tables, equations) for bulk jobs, with a disk-space check first.
- **Vision is a tool the model calls (`vision_analyze`), plus a routing
  choice.** Images attach natively when the main model has vision; otherwise
  an auxiliary vision model describes them up front. The tool exists either
  way, so a page image is always one call away.
- **No RAG or embeddings for documents.** Retrieval is `read_file` with
  offsets plus grep. Embeddings only appear in the memory plugins.

Take-away: the robust pattern is *path plus honest coverage report plus
on-demand escalation*, not "send everything to the model."

## 4. PDF types and routing

Sniff once at upload: page count, per-page character count, a garbage
ratio on the extracted text.

| Type | Detect | Route |
|---|---|---|
| Text layer (exported PDF) | chars per page above threshold, text is words | Extract to text (`unpdf`). |
| Scanned / image-only | chars per page under threshold | Page images on demand; OCR when configured or when large. |
| Mixed | per-page | Text pages as text, empty pages listed in a NEEDS-OCR note. |
| Broken text layer | high ratio of non-printable or non-word glyphs | Treat as scanned. |
| Encrypted | parser error | Refuse with a clear message. |
| Tables, forms, diagrams inside text PDFs | not detectable | Text by default; the model asks for the page image when layout matters. |

Thresholds to start from (Hermes's): 20 chars means an empty page; warn at
2 empty pages and 20 %, or 10 empty pages absolute.

## 5. OCR stance

- Not default. Text layer first, always.
- The model escalates. The coverage note names the empty pages and the
  tool to call. A `document_pages` tool (or a page-range argument on
  `read`) returns chosen pages as images so the main model, if it has
  vision, reads them itself.
- OCR as a configurable route, off unless set: a hosted OCR provider
  through the gateway, or a local engine (Tesseract). When set, it runs
  automatically for whole-scan documents and for scanned page counts past a
  ceiling where vision tokens would cost more than OCR. The model can also
  call it explicitly through the same tool with an `ocr: true` flag.
- Heavy layout OCR (marker-style) stays out of the core; it belongs in a
  skill or an optional MCP server.

## 6. Size tiers

Measured in estimated tokens after extraction, never in file bytes.

1. **Small** (under roughly 10k tokens, configurable): the text is inlined on
   the message, the way an image rides today. Scanned pages inline as
   images, capped at a few.
2. **Medium**: the file is copied into the conversation's `attachments/`
   with the extracted text cached beside it (per page). The environment
   note says name, page count, coverage, and path. The model reads by
   range or greps.
3. **Large** (hundreds to thousands of pages): as medium, plus a generated
   index (table of contents and per-page or per-section one-liners) built
   once in the background. Embeddings and RAG only if range reads and grep
   prove insufficient in use. Not in the first cut.

Composer limits: documents up to 50 MB (matches the library); anything
past a few MB uploads through a streaming endpoint, not base64 in JSON.

## 7. Other document kinds

Same pipeline, different extractor: `.docx`, `.pptx`, `.xlsx` to text;
`.md`, `.txt`, `.csv`, `.json`, source files as-is. Everything ends as
text on disk, page- or section-addressable, so the size tiers apply to all.

## 8. Library

Every uploaded attachment gets the Keep button that pending images already
have. A kept document stores the original bytes and the extracted text
cache so a later conversation does not re-parse it. `library_search`
results for documents state page count and text coverage.

## 9. Parked: the storage concern

Raised 2026-09-22; explicitly accepted as-is for now. Come back to it when
document sizes make it real.

**The concern.** One upload can exist three times: in Flue's attachment
store (keyed by digest), in the conversation's `attachments/` copy, and in
the library. For 10 MB images that is fine. For 100 MB documents it means
disk drain, slow copies, and a composer that blocks on a slow transfer.

**Position.** Keep the three layers conceptually. Flue's store is the
transcript's truth, the conversation copy is what the sandbox can read, and
the library outlives both. Reduce the cost instead of the count:

- Make the conversation copy a hard link or copy-on-write clone where the
  filesystem allows it (NTFS hard links on the same volume; APFS and
  ReFS clone), falling back to a real copy elsewhere. Behaviour is
  unchanged; the bytes exist once.
- Key the extracted-text cache by file digest and store it once under the
  Studio home, shared by conversation and library. Extraction is the
  expensive part, not the bytes.
- Upload through a streaming endpoint with progress; extract in the
  background after the upload lands, so the composer never waits on a
  thousand-page parse.
- Library `add` from a conversation path should link or clone the same way.

None of this changes the user-facing model. Do it after the document
pipeline exists, not before.

## 10. Order of work

1. Composer accepts documents; streaming upload; 50 MB per file.
2. Sniff and extract on the harness: text-layer PDF, scanned detection with
   the coverage note, Office and text formats, digest-keyed cache.
3. Size tiers: inline small; attach medium and large with path, page count
   and coverage in the environment note.
4. `document_pages` tool returning chosen pages as images; `ocr` flag
   wired to a configurable route, off by default.
5. Keep on uploaded documents; library stores bytes plus cache.
6. Later, as needed: summaries index, embeddings, storage work from §9.

## 11. What landed

Branch `task/native-tool-expansion`, commits "A document-reading slot, and
the four vendors that fill it" and "Documents: attached to a message, read
page by page, escalated to OCR".

- **The slot.** `documentReading` is a media slot under a Documents
  category on the Media page. Mistral OCR (`mistral-ocr-latest`, a new
  `mistral` media wire), OpenAI's Responses API, Google's Interactions API
  and OpenRouter's file parts fill it; the three vision routes share one
  transcription instruction and one page-marker cut. Which chat models
  earn it is derived: a vision model on Responses or Interactions, and
  OpenRouter's own `input_modalities=file` listing.
- **Reading.** `documents/extract.ts` reads PDF (pdf.js), Word,
  PowerPoint and Excel (a stdlib ZIP reader, no dependency added) into
  pages with Hermes's coverage rule; the read tool answers all four under
  `[page N]` markers with the NEEDS-OCR note first. The `ocr` tool sends
  named pages to the slot's provider.
- **Attachments.** Documents cannot ride the message (the engine carries
  images only), so the composer uploads them to
  `POST /api/conversations/:id/documents` ahead of the words, as base64
  JSON - the only body the Rust transport carries - and the render's
  `useAgentStart` appends an `attached_documents` signal naming them,
  with the whole text inlined under 40k characters. The transcript reads
  the signal into chips on the user message. Documents whose words did
  not go are taken back. Keep works on a pending document.
- **Not in this cut.** No streaming upload (the transport is string
  bodies; §9). No extracted-text cache, no summaries index, no
  embeddings. `library_search` does not yet report a document's page
  count. Nothing renders a PDF page as a picture for the main model - the
  provider reads the page instead, which is the "real providers, not
  local" decision.
