# Inline image addressing review — 2026-10-08

The complaint's central finding is confirmed by the current implementation:
`copyDeliveredAttachments` created readable files but returned no mapping, while
the environment exposed only the attachments directory. The model had to infer
which file represented each inline image. Flue's delivery hook supplies pixels,
MIME type and optional original filename, but does not supply the projected
transcript attachment ID. Consequently the supported mapping is by position in
the user message, not by inventing an ID-derived filename.

Studio now appends an `attached_images` transcript signal before the model starts.
It gives each image's position and total, original filename when supplied, exact
resolved path, MIME type and decoded byte count. JSON quoting keeps filenames
and paths readable as data. A copy failure produces an explicit unavailable note
while inline pixel delivery continues. The note stays with the upload in history
rather than changing the system prompt.

Same-name overwrite concerns were not confirmed: different bytes already use
numbered suffixes, and repeated identical bytes reuse the existing path. Tests
now verify ordered mappings for both cases and their stability on replay.

Budget opacity is partly confirmed. Read refusals already described count and
byte limits. However the in-memory counter measures only tool images, excludes
inline uploads, and resets on harness restart. Successful reads and image
generation now expose its usage and remaining slots with those qualifications.
Generation no longer silently omits pixels when the local guard refuses them.
Refusals identify Studio's guard rather than claiming a provider error.

Repeated reads do re-send pixels and spend another slot. The attachment note
supplies a stable textual position/path reference and explains that inline
pixels have already arrived, reducing unnecessary reads. This is not provider
pixel deduplication or a guarantee that older pixels survive compaction.

The reported provider wall near 33 images is unverified. No universal provider
remaining-image counter is available here. A transcript-derived, restart-safe
budget and provider-aware context management remain separate work; the current
local guard must not be presented as an accurate total of provider context.
Image dimensions and a provider-native reusable pixel reference are not added
by this change. Generic filesystem missing-file errors remain accurate; the
attachment note removes the invitation to derive a path from a transcript ID.
