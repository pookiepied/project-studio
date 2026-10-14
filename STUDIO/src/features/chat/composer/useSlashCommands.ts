import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useHarnessClient,
  type CommandRecord,
} from '@/platform/harness'
import { useCompactNow } from '@/features/chat/compaction/useCompactNow'
import { matchingCommands, readSlash, slashQuery } from '@/features/chat/composer/slash'

/**
 * The slash, from the composer's side.
 *
 * Three things: the commands the harness lists, read the first time a
 * message begins with `/` and kept for the window; the picker's state while
 * a name is being typed; and what a command does when it is sent. A prompt
 * command expands on the harness - the substitution rules live in one place
 * - and the expanded text is what goes out, so the transcript shows exactly
 * what the model was given. An action command runs here: `/compact` is the
 * one there is, and it is the same action as "Compact now" in the model
 * menu. A slash that names no command is words, and goes out as typed.
 */

export type SlashOutcome =
  /** Not a command: send the words as they are. */
  | { readonly kind: 'words' }
  /** A prompt command: send this text instead. */
  | { readonly kind: 'prompt'; readonly text: string }
  /** An action ran (or was refused); the field clears and the note, if any, shows. */
  | { readonly kind: 'done'; readonly note: string | null }

// The built-in action must never become a chat message just because the
// command listing has not arrived yet. User prompt commands still need it.
const COMPACT_SLASH = /^\/compact(?:\s+[\s\S]*)?$/i

export function useSlashCommands(text: string, conversationId: string | null) {
  const [commands, setCommands] = useState<readonly CommandRecord[] | null>(null)
  const loading = useRef(false)
  const connect = useHarnessClient()
  const { compactNow } = useCompactNow()

  // Read once, the first time a slash is typed. A command written in
  // Settings meanwhile is picked up by the next window; the list is small
  // and the cost of re-reading it on every keystroke is not worth paying.
  const query = slashQuery(text)
  useEffect(() => {
    if (query === null || commands !== null || loading.current) return
    loading.current = true
    void (async () => {
      const harness = await connect()
      if (harness === null) {
        loading.current = false
        return
      }
      const result = await harness.listCommands()
      loading.current = false
      if (result.ok) setCommands(result.value.commands)
    })()
  }, [query, commands, connect])

  const suggestions = query === null || commands === null ? null : matchingCommands(query, commands)
  const [selected, setSelected] = useState(0)
  useEffect(() => {
    setSelected(0)
  }, [query])

  /** What sending the field's text does. */
  const resolve = useCallback(
    async (message: string): Promise<SlashOutcome> => {
      if (COMPACT_SLASH.test(message.trim())) {
        if (conversationId === null) {
          return { kind: 'done', note: 'Nothing to compact yet: start a conversation first.' }
        }
        return { kind: 'done', note: await compactNow(conversationId) }
      }
      const slash = readSlash(message, commands ?? [])
      if (slash === null) return { kind: 'words' }
      if (slash.command.kind === 'action') {
        return { kind: 'done', note: `"/${slash.command.id}" is not something this window can run.` }
      }
      const harness = await connect()
      if (harness === null) return { kind: 'done', note: 'No harness is configured.' }
      const expanded = await harness.expandCommand(slash.command.id, slash.args)
      if (!expanded.ok) return { kind: 'done', note: expanded.error.message }
      return { kind: 'prompt', text: expanded.value }
    },
    [commands, conversationId, compactNow, connect],
  )

  /** Whether the text names a command at all - synchronously, for the send path. */
  const isCommand = useCallback(
    (message: string) => COMPACT_SLASH.test(message.trim()) || readSlash(message, commands ?? []) !== null,
    [commands],
  )

  const isAction = useCallback(
    (message: string) => COMPACT_SLASH.test(message.trim()) || readSlash(message, commands ?? [])?.command.kind === 'action',
    [commands],
  )

  return {
    /** The picker's rows while a name is being typed; null when it is not. */
    suggestions,
    selected,
    setSelected,
    isCommand,
    isAction,
    resolve,
  }
}
