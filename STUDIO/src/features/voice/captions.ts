/**
 * The spoken reply as words on the stage.
 *
 * The caption is the reply's text, not its rendering: the voice agent may
 * still emit Markdown, and `**`, backticks or a heading's `#` read on the
 * stage as noise the voice never said. Those marks are dropped; punctuation
 * stays attached to the word it follows.
 *
 * The result alternates words and the whitespace between them, so the stage
 * can animate each word as a block while the gaps stay ordinary text. A gap
 * rendered as an inline-block collapses to nothing, which is how the caption
 * once ran its words together.
 */
export function captionTokens(text: string): string[] {
  const plain = text
    .replace(/```[^\n]*\n?/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?=\S))/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,!?;:]|$)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  return plain.split(/(\s+)/).filter(Boolean).map((token) => (/^\s+$/.test(token) ? ' ' : token))
}

/** True for the gaps `captionTokens` keeps between words. */
export function isGap(token: string): boolean {
  return token === ' '
}
