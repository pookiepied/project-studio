/**
 * Name a conversation from its first message.
 *
 * First sentence or first eight words, whichever is shorter, and never a
 * trailing ellipsis: a title that admits it was truncated reads as broken,
 * while one that simply stops reads as brief.
 */
export function deriveTitle(firstMessage: string): string {
  const sentence = firstMessage.split(/(?<=[.?!])\s/)[0] ?? firstMessage
  const words = sentence.trim().split(/\s+/)
  const clipped = words.length > 8 ? words.slice(0, 8).join(' ') : sentence.trim()
  return clipped.replace(/[.,;:]$/, '')
}
