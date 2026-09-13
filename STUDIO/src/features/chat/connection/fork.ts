import { useCallback, useState } from 'react'

import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { newId } from '@/lib/id'
import {
  createConversationClient,
  createHarnessClient,
  resolveHarnessAddress,
  turnSettingsToWire,
  type ConversationMessageFacts,
} from '@/platform/harness'
import { startConversation } from '@/features/chat/connection/first-turn'
import { effectiveTurnSettings } from '@/domain/turn/settings'
import type { Conversation } from '@/domain/conversation/types'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * Forking a conversation.
 *
 * ---- What a fork is here ---------------------------------------------------
 *
 * A fork is a new, ordinary conversation whose first message carries the
 * source conversation's words up to a point, followed by whatever the person
 * types next. Flue - the runtime that owns every transcript - has no branch
 * API (measured against its whole surface: ids are caller-chosen, streams
 * start empty, context is always rebuilt from the journal, and the agent's
 * first turn begins from nothing), so the fork is built from public seams
 * only: the words are read from the projection or from a history snapshot,
 * rendered as text, and admitted as the new conversation's first turn through
 * the same path every first turn takes.
 *
 * The cost is stated where it is accepted: the inherited context is a text
 * rendering, not the model's own context - tool calls become a line noting
 * they happened, thinking is dropped, and long histories are a long first
 * message. What the fork buys is the whole conversation graph being ordinary
 * conversations: renamable, archivable, detachable, purgeable, with no
 * private lineage anywhere.
 *
 * ---- What forking is not ---------------------------------------------------
 *
 * Not a copy. The source keeps its own record, its own stream, its own title;
 * the fork is named for what it is - the source's title, plus " (Fork)" -
 * and the name is written through the rename path, so it sticks the way a
 * person's own rename would.
 */

export interface SeedTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** The source title, as the fork's seed names it. */
function sourceName(title: string | null): string {
  const named = title?.trim()
  return named === undefined || named === '' ? 'this conversation' : `"${named}"`
}

/**
 * The inherited words, as one message. Tool runs become a single line - their
 * inputs and outputs are the model's business, not the transcript's - and
 * thinking is left out entirely: it was the writing, not what was said.
 */
export function renderSeed(sourceTitle: string | null, turns: readonly SeedTurn[]): string {
  const body = turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text.trim()}`)
    .join('\n\n')
  return [
    `The transcript below is the history of ${sourceName(sourceTitle)}, carried over as context. Continue naturally from where it ends.`,
    '',
    '--- transcript ---',
    body,
    '--- end ---',
  ].join('\n')
}

/**
 * The turns up to and including the named assistant message, taken from the
 * live projection - the same words on screen, no second read. "Branch from
 * here" means from this answer onward, so the answer itself is in.
 */
export function turnsUpTo(
  items: readonly TranscriptItem[],
  assistantMessageId: string,
): SeedTurn[] {
  const turns: SeedTurn[] = []
  for (const item of items) {
    if (item.kind === 'user') {
      if (item.text.trim() !== '') turns.push({ role: 'user', text: item.text })
      continue
    }
    if (item.kind !== 'assistant') continue
    const written = item.segments
      .filter((segment) => segment.kind === 'text')
      .map((segment) => segment.text)
      .join('\n\n')
    if (written.trim() !== '') turns.push({ role: 'assistant', text: written })
    if (item.id === assistantMessageId) break
  }
  return turns
}

function turnsOfMessages(messages: readonly ConversationMessageFacts[]): SeedTurn[] {
  const turns: SeedTurn[] = []
  for (const message of messages) {
    // 2.0's runtime advisories (abort markers and the like) arrive as
    // `system` messages. They are not words anybody said, so a fork's
    // inherited transcript does not carry them either.
    if (message.role === 'system') continue
    const written = message.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n\n')
    if (written.trim() === '') continue
    turns.push({ role: message.role, text: written })
  }
  return turns
}

/**
 * One cold read of a conversation's words, for a fork fired from the sidebar
 * where nothing is loaded. The client's own cold start reads history first
 * and delivers it as a snapshot; this takes exactly that delivery, stops the
 * read, and answers with the words or `null` when the harness has no stream
 * under the name.
 */
async function readTurns(conversationId: string): Promise<SeedTurn[] | null> {
  const address = await resolveHarnessAddress()
  if (address === null) return null
  const client = createConversationClient({ conversationId })
  return new Promise((resolve) => {
    const handle = client.attach({
      onEvent: (delivery) => {
        if (delivery.kind === 'snapshot') {
          void handle.cancel()
          resolve(turnsOfMessages(delivery.snapshot.messages))
        } else if (delivery.kind === 'absent') {
          resolve(null)
        }
      },
    })
    void handle.settled.then((settlement) => {
      if (settlement.outcome !== 'ended' && settlement.outcome !== 'absent') resolve(null)
    })
  })
}

/** What a fork got to: the new conversation, only when the harness took the seed. */
export type ForkOutcome =
  | { readonly ok: true; readonly conversationId: string }
  | { readonly ok: false; readonly note: string }

const FORK_SUFFIX = ' (Fork)'

export function useForkConversation() {
  const [busy, setBusy] = useState(false)
  const { beginConversation, settings } = useWorkspace()
  const { openChat } = useNavigation()

  const fork = useCallback(
    async (input: {
      readonly source: Conversation
      readonly turns: SeedTurn[] | null
    }): Promise<ForkOutcome> => {
      if (input.turns === null || input.turns.length === 0) {
        return { ok: false, note: 'There is nothing said yet to fork.' }
      }
      setBusy(true)
      try {
        const title = `${input.source.title ?? 'Untitled'}${FORK_SUFFIX}`
        const seed = renderSeed(input.source.title, input.turns)
        const conversationId = newId('cnv')
        // The fork speaks with the settings its source was holding - the same
        // model, reasoning and permission mode the words were written under -
        // not whatever the window's picker happens to show right now.
        const effective = effectiveTurnSettings(input.source, settings)
        const outcome = await startConversation({
          text: seed,
          settings: turnSettingsToWire(effective),
        })
        if (!outcome.ok) {
          return { ok: false, note: outcome.error.message }
        }
        // The name is written through the rename path, so it is a manual
        // title: the harness derives nothing over it later, and a reload
        // agrees with the sidebar.
        const address = await resolveHarnessAddress()
        if (address !== null) {
          await createHarnessClient(address).updateConversation(conversationId, { title })
        }
        beginConversation({
          id: conversationId,
          firstMessage: seed,
          projectId: input.source.projectId,
          settings: effective,
          title,
        })
        openChat(conversationId)
        return { ok: true, conversationId }
      } finally {
        setBusy(false)
      }
    },
    [beginConversation, openChat, settings],
  )

  /** Fork everything: the words are read here, once, from the harness. */
  const forkWhole = useCallback(
    async (source: Conversation): Promise<ForkOutcome> =>
      fork({ source, turns: await readTurns(source.id) }),
    [fork],
  )

  /** Branch from one answer: the words are already on screen. */
  const branchFrom = useCallback(
    async (source: Conversation, items: readonly TranscriptItem[], messageId: string) =>
      fork({ source, turns: turnsUpTo(items, messageId) }),
    [fork],
  )

  return { busy, branchFrom, forkWhole }
}
