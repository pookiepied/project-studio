/**
 * A frame, in the two forms the transcript can carry it.
 *
 * The persistence layer stores every tool-result image in the attachment
 * store and leaves the transcript holding a reference (`att_...`), so a frame
 * read out of a call is usually that reference and must be fetched before it
 * can be shown. An inline frame - real base64 in the block itself - still
 * exists wherever the result was never persisted through the store, and is
 * renderable as it stands.
 */
export type BrowserFrame =
  | { readonly kind: 'inline'; readonly data: string; readonly mimeType: string }
  | { readonly kind: 'attachment'; readonly id: string; readonly mimeType: string }

/**
 * One answered browser call, as the rail's step list carries it.
 *
 * Everything here is a fact the call itself reported: the verb tensed by its
 * own outcome, the subject it acted on, the place it landed, whether it
 * failed, and the frame it brought back (a reference, most of the time). The
 * rail's "What happened" is a list of these, and the transcript's report row
 * is the same list - one vocabulary, two sizes.
 */
export interface BrowserStep {
  /** The tool call's own id, which keys the step in a list. */
  readonly id: string
  /** The bare action: `open`, `click`, `read_text`. */
  readonly action: string
  /** The verb in the past tense; an answered call has happened. */
  readonly verb: string
  /** What the call acted on, read from its input. */
  readonly subject: string | null
  /** Where the page was when the call answered. */
  readonly url: string | null
  /** The page's own name for itself, when the call reported one. */
  readonly title: string | null
  readonly failed: boolean
  readonly frame: BrowserFrame | null
  /**
   * Whether this call is over, either way.
   *
   * Read by the rail to decide whether its report changed, and it has to be
   * stated rather than inferred from the other fields. The obvious inference -
   * "it has a frame or it failed" - is wrong for the eight tools that only
   * read: `read_text`, `console`, `tabs` and the rest answer with words and no
   * picture, so a call of theirs going from running to answered changes none
   * of the fields a signature could otherwise notice. The rail would keep
   * showing "reading the page" after the page had been read.
   */
  readonly settled: boolean
}
