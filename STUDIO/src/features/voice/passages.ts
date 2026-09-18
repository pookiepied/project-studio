/**
 * Where one read-aloud request ends and the next begins.
 *
 * A message is spoken as a run of passages, each its own request to the
 * speech provider, played back to back. Two facts shape the cut. The first
 * sound should arrive after one short render, not after the whole message
 * has been rendered, so the opening passage is kept small. And a passage
 * cut mid-sentence renders as a sentence in two halves with a breath in
 * the wrong place, so every cut lands at a sentence end where there is one,
 * a clause where there is not, and a space only when a single word run
 * would otherwise pass the ceiling.
 *
 * The ceilings are well under the harness's own per-request limit (4096
 * characters in `gateway/media/service.ts`), which is a provider fact and
 * not a pacing choice; a passage here is sized for how long a person waits,
 * not for what the wire allows.
 *
 * Pure on purpose: the narration loop is where this is used, and a string
 * is how it is tested.
 */

/** The opening passage: one render this long is the wait before any sound. */
export const FIRST_PASSAGE_CHARS = 280
/** Every later passage renders while the one before it plays, so it can be longer. */
export const PASSAGE_CHARS = 900

/** A break between paragraphs, or the end of a sentence followed by space. */
const SENTENCE_END = /(?<=[.!?]["')\]]?)\s+|\n\s*\n/
/** A clause boundary, for a sentence that alone passes the ceiling. */
const CLAUSE_END = /(?<=[,;:])\s+/

export function splitPassages(text: string): readonly string[] {
  const sentences = text
    .split(SENTENCE_END)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')

  const passages: string[] = []
  let current = ''
  const ceiling = (): number => (passages.length === 0 ? FIRST_PASSAGE_CHARS : PASSAGE_CHARS)
  for (const sentence of sentences) {
    // A sentence that will not join the passage being built is cut to the
    // ceiling of the passage it opens, not of the one it was refused by:
    // the opening ceiling is short, and a long second sentence sized to it
    // would arrive as several requests where one would do.
    if (current !== '' && current.length + 1 + sentence.length > ceiling()) {
      passages.push(current)
      current = ''
    }
    for (const piece of fitted(sentence, ceiling())) {
      if (current === '') {
        current = piece
      } else if (current.length + 1 + piece.length <= ceiling()) {
        current = `${current} ${piece}`
      } else {
        passages.push(current)
        current = piece
      }
    }
  }
  if (current !== '') passages.push(current)
  return passages
}

/** One sentence as pieces that each fit the ceiling, cut where speech would pause. */
function fitted(sentence: string, ceiling: number): readonly string[] {
  if (sentence.length <= ceiling) return [sentence]
  const pieces: string[] = []
  let current = ''
  for (const clause of sentence.split(CLAUSE_END)) {
    for (const word of clause.length <= ceiling ? [clause] : byWords(clause, ceiling)) {
      if (current === '') {
        current = word
      } else if (current.length + 1 + word.length <= ceiling) {
        current = `${current} ${word}`
      } else {
        pieces.push(current)
        current = word
      }
    }
  }
  if (current !== '') pieces.push(current)
  return pieces
}

/** The last resort: a clause with no pause in it, cut at spaces, then hard. */
function byWords(clause: string, ceiling: number): readonly string[] {
  const pieces: string[] = []
  for (const word of clause.split(/\s+/)) {
    if (word.length <= ceiling) {
      pieces.push(word)
      continue
    }
    for (let at = 0; at < word.length; at += ceiling) {
      pieces.push(word.slice(at, at + ceiling))
    }
  }
  return pieces
}
