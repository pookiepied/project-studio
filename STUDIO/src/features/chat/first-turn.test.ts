import { describe, expect, it } from 'vitest'

import {
  createConversationClient,
  type ServiceInvoke,
  type StreamChannel,
  type WireStreamEvent,
} from '@/platform/harness'
import { firstAdmission, forgetFirstAdmission } from '@/features/chat/first-attach'
import type { ContactHarness } from '@/features/chat/useConversation'

import { startConversation } from './first-turn'

/**
 * The first turn of a conversation, which until now was a demo.
 *
 * Home and a project page both sent through the workspace store's local demo
 * runner: the message never left the window, and the conversation the send
 * created was one the harness had never heard of, so the page it opened
 * attached to nothing. The order these tests pin is the whole fix — the
 * harness takes the message FIRST, and only an admitted send produces an id,
 * a receipt to hand across, and a page to open.
 */

interface Attempt {
  readonly bodies: string[]
  readonly contactFor: (conversationId: string) => ContactHarness
}

/** A harness that admits, refuses, or is not running at all. */
function harness(mode: 'admits' | 'refuses' | 'absent'): Attempt {
  const bodies: string[] = []
  const channel = (): StreamChannel => ({ id: 1 })
  const invoke: ServiceInvoke = async (command, args) => {
    if (command !== 'service_fetch') throw new Error(`no scripted answer for ${command}`)
    const init = args?.['init']
    const body =
      typeof init === 'object' && init !== null && 'body' in init ? init['body'] : undefined
    bodies.push(String(body ?? ''))
    if (mode === 'refuses') {
      return { status: 403, headers: [], body: JSON.stringify({ error: 'admission denied' }) }
    }
    return {
      status: 200,
      headers: [],
      body: JSON.stringify({ submissionId: 'sub_first', offset: '9_4' }),
    }
  }
  const contactFor = (conversationId: string): ContactHarness => async () =>
    mode === 'absent'
      ? { kind: 'absent' }
      : {
          kind: 'ready',
          client: createConversationClient({
            conversationId,
            invoke,
            createChannel: (_onMessage: (message: WireStreamEvent) => void) => channel(),
          }),
        }
  return { bodies, contactFor }
}

describe('starting a conversation with a live first turn', () => {
  it('mints an id, admits the turn, and keeps the receipt for the view to come', async () => {
    const attempt = harness('admits')
    const outcome = await startConversation({
      text: 'the first thing anyone types',
      contactFor: attempt.contactFor,
      now: () => 1_700_000_000_000,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(attempt.bodies).toEqual([JSON.stringify({ message: 'the first thing anyone types' })])
    // The handoff: where this turn's events begin, what to call it while it
    // has produced nothing, and the words themselves. Without the first the
    // view that mounts next asks history about a stream that is milliseconds
    // old; without the last it opens on an empty column until the harness
    // echoes back the message the person just watched leave the composer.
    expect(firstAdmission(outcome.conversationId)).toEqual({
      offset: '9_4',
      submissionId: 'sub_first',
      text: 'the first thing anyone types',
      // The moment of admission, which the view that mounts next counts the
      // model's wait from. Taken here rather than there because a navigation
      // sits between the two.
      at: 1_700_000_000_000,
    })
    forgetFirstAdmission(outcome.conversationId)
  })

  it('creates nothing at all when the harness refuses the send', async () => {
    // The reason the submission happens before any navigation: the words are
    // still in the field the person typed them into, there is no conversation
    // in the sidebar for a turn that never ran, and the id was never used.
    const attempt = harness('refuses')
    const outcome = await startConversation({
      text: 'this one bounces',
      contactFor: attempt.contactFor,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error).toEqual({
      kind: 'refused',
      status: 403,
      message: 'admission denied',
    })
  })

  it('never posts anything when there is no harness to post to', async () => {
    const attempt = harness('absent')
    const outcome = await startConversation({
      text: 'anyone there?',
      contactFor: attempt.contactFor,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.kind).toBe('no-harness')
    expect(attempt.bodies).toEqual([])
  })

  it('gives every send its own conversation, so two sends are two conversations', async () => {
    const attempt = harness('admits')
    const one = await startConversation({ text: 'first', contactFor: attempt.contactFor })
    const two = await startConversation({ text: 'second', contactFor: attempt.contactFor })

    expect(one.ok && two.ok).toBe(true)
    if (!one.ok || !two.ok) throw new Error('unreachable')
    expect(one.conversationId).not.toBe(two.conversationId)
    forgetFirstAdmission(one.conversationId)
    forgetFirstAdmission(two.conversationId)
  })
})
