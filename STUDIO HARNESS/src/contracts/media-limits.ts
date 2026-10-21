/**
 * Every limit a picture, attachment or document is held to in the harness.
 *
 * One place, so a value is changed once and its reason is next to it. The
 * full table, with the provider facts behind each number and the decisions
 * taken about them, is `documentation/architecture/media-limits.md`; update
 * both together. Units are in the names: `_BYTES` are raw bytes,
 * `_BASE64_CHARS` encoded characters, `_PX` pixels.
 *
 * Provider media adapters (`gateway/media/adapters/*`) keep their own limits:
 * those are each vendor's documented numbers and belong with the vendor code.
 */

// ---- What one turn may attach (the client enforces these at pick time) ----
// `STUDIO/src/domain/attachments/limits.ts` must hold the same values;
// `media-limits.test.ts` checks that it does.

/** Pictures one message carries. Every provider Studio serves accepts at least this many. */
export const TURN_MAX_IMAGES = 5;
/** One attached picture. Below Flue's 14 MiB base64 ceiling per image, with room for the JSON around it. */
export const TURN_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** All of one message's pictures together: 15 MB is 20 MB of base64, inside Anthropic's 32 MB request. */
export const TURN_IMAGES_TOTAL_MAX_BYTES = 15_000_000;
/** Documents one message carries. */
export const TURN_MAX_DOCUMENTS = 5;

// ---- Documents --------------------------------------------------------------

/** One document file, attached or read. Extraction holds the file in memory. */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
/** Document text placed straight into the message; longer documents are read by page. */
export const DOCUMENT_INLINE_CHARS = 40_000;
/** Spreadsheet rows read per sheet; past this a sheet is data for a script, not a read. */
export const SHEET_MAX_ROWS = 5_000;
/** Spreadsheet columns read per sheet: one stray cell far right would pad every row with tabs. */
export const SHEET_MAX_COLUMNS = 1_024;
/** Saved attachment file names are cut to this, extension kept. */
export const ATTACHMENT_NAME_MAX_CHARS = 120;

// ---- Pictures tools return ----------------------------------------------------

/** One picture from `read` or a media tool. Anthropic's ceiling is 5 MB on Bedrock and Vertex. */
export const TOOL_PICTURE_MAX_BYTES = 5_000_000;
/** One computer or browser screenshot, encoded; a PNG over it is sent as a JPEG, then shrunk. */
export const SCREENSHOT_MAX_BYTES = 1_000_000;
/**
 * Longest side of a screenshot or zoom. Anthropic scales larger pictures down
 * to about this before the model sees them, so more only costs upload time.
 */
export const SCREENSHOT_SIDE_PX = 1568;
/** Longest side of the picture returned after each input: a check, not a reading. */
export const AFTER_ACTION_SIDE_PX = 1280;

// ---- What one model request carries (gateway/language/image-window.ts) --------

/** Most pictures one request carries. Generous: most routes accept 50 or more. */
export const REQUEST_MAX_PICTURES = 50;
/** Most base64 one request's pictures carry: two thirds of Anthropic's 32 MB request. */
export const REQUEST_PICTURE_BASE64_CHARS = 20_000_000;
/** Pictures are left out in multiples of this, so the cached start of a request stays put. */
export const REQUEST_PICTURE_CUT_STEP = 10;
/** Share of the model's context window pictures may take. */
export const REQUEST_PICTURE_CONTEXT_SHARE = 0.25;
/** Tokens one picture costs at the provider's working size (about 1568 x 1000 / 750). */
export const PICTURE_TOKENS = 1_600;
/**
 * Anthropic: once a request holds more than this many pictures, every one of
 * them must be at most `MANY_PICTURES_SIDE_PX` on each side, or the whole
 * request is refused. Applies through OpenRouter too.
 */
export const MANY_PICTURES_THRESHOLD = 20;
export const MANY_PICTURES_SIDE_PX = 2_000;
/** Longest side past which providers scale a picture down; the model is told. */
export const PROVIDER_DOWNSCALE_SIDE_PX = 1568;
