import type { CommandRecord } from '@/platform/harness'

/**
 * Reading a slash out of the field.
 *
 * A message is a command when it begins with `/` followed by a name the
 * harness lists, and nothing else the person could have meant: `/usr/bin`
 * is a path, `/ hello` is a sentence, and both stay words. The name ends at
 * the first whitespace; everything after it is the arguments, exactly as
 * typed. Pinned in `slash.test.ts`.
 */

const NAME = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i

/** A command the field holds, or null when the field holds words. */
export function readSlash(
  text: string,
  commands: readonly CommandRecord[],
): { readonly command: CommandRecord; readonly args: string } | null {
  const match = NAME.exec(text.trim())
  if (match === null) return null
  const id = (match[1] ?? '').toLowerCase()
  const command = commands.find((entry) => entry.id === id)
  if (command === undefined) return null
  return { command, args: (match[2] ?? '').trim() }
}

/**
 * The name being typed after a slash, while it is still being typed: the
 * field holds `/` and letters and nothing else. Null the moment a space
 * follows, because the name is finished and the picker would only be in
 * the way of the arguments.
 */
export function slashQuery(text: string): string | null {
  const match = /^\/([a-z0-9-]*)$/i.exec(text)
  return match === null ? null : (match[1] ?? '').toLowerCase()
}

/**
 * The commands the picker offers for a query: names that start with it
 * first, in the harness's order, then names that contain it. An empty
 * query offers everything.
 */
export function matchingCommands(
  query: string,
  commands: readonly CommandRecord[],
): readonly CommandRecord[] {
  if (query === '') return commands
  const starts = commands.filter((command) => command.id.startsWith(query))
  const contains = commands.filter(
    (command) => !command.id.startsWith(query) && command.id.includes(query),
  )
  return [...starts, ...contains]
}
