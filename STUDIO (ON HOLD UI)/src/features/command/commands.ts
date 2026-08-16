import type { ComponentType } from 'react'
import type { IconSize } from '@/components/icons'

export type CommandGroup = 'Projects' | 'Conversations' | 'Actions'

export interface Command {
  id: string
  /** What the row reads. Also the primary match target. */
  label: string
  /** The quieter second line: a project name, a folder, a shortcut hint. */
  detail?: string
  group: CommandGroup
  icon: ComponentType<{ size?: IconSize; className?: string }>
  /** Extra words that should match but should not be shown. */
  keywords?: string
  run: () => void
}

/** The order groups appear in. Destinations before verbs: you are usually
 *  going somewhere, and only sometimes doing something. */
export const GROUP_ORDER: readonly CommandGroup[] = ['Projects', 'Conversations', 'Actions']

/**
 * Subsequence match — the "fzf" behaviour people expect from a palette.
 *
 * `afs` matches "Aurora Film Score" because the characters appear in order,
 * not because the string contains "afs". A plain `includes` would fail that,
 * and failing it is what makes a palette feel like a dumb filter box.
 *
 * Returns a score rather than a boolean so the caller can rank: lower is
 * better. The score is the span the match occupies — a tight run of characters
 * near the start beats the same letters scattered across a long name.
 */
export function matchScore(text: string, query: string): number | null {
  if (!query) return 0

  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()

  // A whole-word prefix is what the user almost always meant; short-circuit it
  // to the top rather than letting subsequence scoring rank it against a
  // coincidentally tighter match elsewhere.
  if (haystack.startsWith(needle)) return -1000 + needle.length
  const wordStart = haystack.indexOf(` ${needle}`)
  if (wordStart >= 0) return -500 + wordStart

  let first = -1
  let cursor = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor)
    if (found === -1) return null
    if (first === -1) first = found
    cursor = found + 1
  }
  // Span plus a small penalty for starting late.
  return cursor - first + first * 0.1
}

/** Rank a command list against a query, dropping non-matches. */
export function rankCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands

  const scored: Array<{ command: Command; score: number }> = []
  for (const command of commands) {
    const target = `${command.label} ${command.detail ?? ''} ${command.keywords ?? ''}`
    const score = matchScore(target, query.trim())
    if (score !== null) scored.push({ command, score })
  }

  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.command)
}
