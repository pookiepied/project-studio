# The read tool tells the truth about a picture it cannot show

A droppable task. Everything below was measured or read from the code on
2026-09-08; nothing in it is a guess you need to re-derive.

## What happened

A model was asked to read thirteen images in `C:\Users\pooki\Pictures\test`
and wrote up what it found in
`~/.studio/data/conversations/cnv_9a4bvikj/workspace/sandbox-session-report.md`
(finding F10). Eight were read. Two - a 4 MB BMP and a 1.8 MB TIFF - came
back with this:

> This file is 4102 KB, which is too large to read at once. Search it instead.

That sentence is wrong three times over. The limit it reports is the text
limit, not the image limit. The advice cannot be followed, because there is
nothing to search inside a bitmap. And the real reason - the model cannot be
shown a BMP at all - is never said, so the model has no way to learn what
would have worked.

## Why it happens

`STUDIO HARNESS/src/tools/filesystem/read.ts`.

`IMAGE_MIME_BY_EXTENSION` (line 47) lists five extensions: png, jpg, jpeg,
gif, webp. Anything else has no mime, so `mimeType === undefined`, so the file
takes the text path: the 1 MiB `MAX_TEXT_BYTES` check, and then
`context.sandbox.readFile`.

That gives a BMP two different wrong answers depending on its size. Over 1 MiB
it gets the message above. Under 1 MiB it is read as text, hits the NUL-byte
guard further down, and is refused as binary - a truthful refusal, but for the
wrong reason and without naming a remedy.

## What to do

**Do not add BMP and TIFF to the map.** This is the obvious-looking fix and it
is wrong. The vision models accept png, jpeg, gif and webp only; adding those
extensions would turn a bad error message into a failed provider call, which is
strictly worse. Confirm this against the provider catalog before you decide
anything else - if it turns out a served model does accept more, that changes
the answer and you should say so in your report rather than proceeding.

**Refuse by kind, before the size check.** The PDF branch immediately above the
size check is the precedent and the shape to copy: it sits ahead of the size
check deliberately, refuses whatever the file weighs, and says why in a sentence
the model can act on. Read its comment - it explains the ordering rule you are
following.

A picture we cannot show should hear something like: this is a BMP, the model
can be shown PNG, JPEG, GIF and WebP, convert it and read it again. Name the
formats. A refusal that does not say what would have worked teaches nothing.

Which extensions get this treatment is your call to make and to justify: bmp,
tiff, tif, svg, heic, heif, avif, ico are the candidates a person would
plausibly point the tool at. SVG deserves a thought of its own - it is text,
and reading it as text is arguably right.

**Then: decide the kind from the bytes, not the name.** Today the tool trusts
the extension completely. In the test set `12-mislabelled.jpg` held PNG bytes,
and it worked - but only because the provider was tolerant, not because we did
anything correct. The reverse case fails badly: a real PNG named `.txt` is read
as text and refused as binary.

Sniffing the magic bytes makes that deliberate. Be careful with the ordering:
the current decision is made from `stat` alone, before any file content is
read, and the size checks depend on knowing the kind. Reading a small head of
the file before deciding is fine; reading a 58 MB file into memory to learn it
is a PNG is not. Say in your report which order you chose and what it costs.

If the two halves fight each other, do the refusal first and land it. It is the
bug a person actually hit.

## What must not break

- The image path itself. `MAX_IMAGE_BYTES`, the conversation image budget, the
  `acceptsImages` refusal, the access-log record and the raw-bytes read (never
  through `sandbox.readFile`, which decodes utf8 and would corrupt a picture)
  all stay exactly as they are.
- The PDF refusal, and its position ahead of the size check.
- The NUL-byte binary guard. It is the backstop for everything sniffing does
  not recognise, and it stays even if sniffing lands.
- The 1 MiB text limit and its message, for files that really are text.

## Testing

`pnpm test` from `STUDIO HARNESS`, and **never two suites at once** - both
rewrite `dist/`, and a vitest run started directly tests a stale bundle after a
source edit. Baseline before you start is 1835 passing, 25 skipped, 0 failing.

There are real files to try at `C:\Users\pooki\Pictures\test`, including
`06-uncompressed.bmp` (4 MB), `07-photo.tiff` (1.8 MB) and
`12-mislabelled.jpg` (PNG bytes, jpg name). The report suggests adding a BMP
and a TIFF *under* 1 MB, which would expose the second wrong message; a unit
test is the better home for that, but the files are cheap to make.

## Out of scope

Converting or downscaling an image so it can be read. That needs the shell,
the shell is currently broken on this machine
(`documentation/work/toolchain-onboarding-brief.md`), and it is the next task
after this one. Note the dependency if you touch anything near it, and leave it
alone otherwise.
