import { isRecord } from '@/lib/guards'

/**
 * Reading words out of a tool call's input and answer.
 *
 * An answer arrives as a string, or as a content list of typed blocks, or
 * as either of those wrapped once in `value` or `result` by the log. The
 * text is what the blocks of type `text` say, joined; pictures and the
 * rest are not words. Shared by every reader that parses an answer's fixed
 * shape - a generation's `Artifact:` lines, a search's numbered hits.
 */

function blocks(output: unknown): readonly unknown[] {
  if (Array.isArray(output)) return output
  if (!isRecord(output)) return []
  const content = output['content']
  if (Array.isArray(content)) return content
  const inner = output['value'] ?? output['result']
  return inner === undefined ? [] : blocks(inner)
}

/** Every text block of an answer, joined by newlines; a string as itself. */
export function answerText(output: unknown): string {
  if (typeof output === 'string') return output
  return blocks(output)
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block['type'] === 'text' && typeof block['text'] === 'string')
    .map((block) => block['text'] as string)
    .join('\n')
}

/** A non-empty string field of an input, trimmed; null for anything else. */
export function inputString(input: unknown, key: string): string | null {
  return isRecord(input) && typeof input[key] === 'string' && input[key].trim() !== ''
    ? input[key].trim()
    : null
}
