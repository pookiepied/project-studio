/**
 * The one place a conversation's index row is written.
 *
 * `stores/workspace/deriveTitle.ts` in the webview used to own this job,
 * alongside everything else about a conversation's identity. The index lives
 * here now, and with it the naming rule: deriving a title at both ends is how
 * two spellings of the same sentence start drifting apart. The webview sends
 * the words a person typed; this module decides what they become.
 *
 * The rule itself is unchanged, verbatim, because titles that exist already
 * must keep their existing spelling: first sentence, or first eight words
 * whichever is shorter, trailing punctuation of the last word removed, and
 * never a trailing ellipsis - a title that admits it was truncated reads as
 * broken, while one that simply stops reads as brief.
 */
export function deriveTitle(firstMessage: string): string {
  const sentence = firstMessage.split(/(?<=[.?!])\s/)[0] ?? firstMessage;
  const words = sentence.trim().split(/\s+/);
  const clipped = words.length > 8 ? words.slice(0, 8).join(" ") : sentence.trim();
  return clipped.replace(/[.,;:]$/, "");
}
