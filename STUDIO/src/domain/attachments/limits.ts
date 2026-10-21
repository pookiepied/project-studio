/**
 * Every limit the composer holds an attachment to, in one place.
 *
 * The harness holds the same values in `STUDIO HARNESS/src/contracts/media-limits.ts`
 * (its `TURN_*` constants), and its `media-limits.test.ts` checks this file
 * against them. The full table and the reasons are in
 * `documentation/architecture/media-limits.md`; change all three together.
 */

/** Pictures one message carries. Every provider Studio serves accepts at least this many. */
export const MAX_IMAGES_PER_TURN = 5

/** One picture, in bytes after decoding: under Flue's 14 MiB base64 ceiling with the JSON around it. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * All of one message's pictures together, in bytes. 15 MB is 20 MB of base64,
 * inside the 32 MB request Anthropic accepts with room for the conversation.
 */
export const MAX_IMAGE_BYTES_PER_TURN = 15_000_000

/** Documents one message carries. */
export const MAX_DOCUMENTS_PER_TURN = 5

/** One document: the harness's own ceiling for a file it opens. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
