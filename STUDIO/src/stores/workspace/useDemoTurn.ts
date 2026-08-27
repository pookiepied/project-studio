import { useCallback, useEffect, useRef } from 'react'
import { demoReply, demoThinking } from '@/domain/session/demo'
import { newId } from '@/lib/id'
import type { Conversation, Message } from '@/domain/session/types'

/**
 * The stand-in runtime.
 *
 * This is the entire demo transport, isolated behind the same shape a real one
 * will have: start a turn, emit a reasoning trace, stream text, finish, and be
 * cancellable at any point. `WorkspaceProvider` calls `run` and `cancel` and
 * knows nothing about how the text arrives, so replacing this file is the whole
 * migration.
 *
 * Timers are tracked rather than fired and forgotten: a stray interval that
 * outlives the component keeps calling setState on a dead tree, and cancelling
 * a turn has to actually stop the words.
 */

/** Milliseconds between chunks, and words per chunk. */
const THINK_TICK = 26
const STREAM_TICK = 28
const STREAM_WORDS = 2
/** How long the model appears to consider before any text arrives. */
const LEAD_IN = 380

type TurnPatch = (change: (conversation: Conversation) => Conversation) => void

export interface TurnRun {
  /** The reference a real turn would carry; null is the harness's default. */
  readonly modelId: string | null
  readonly patch: TurnPatch
  readonly onThinking: () => void
  readonly onStreaming: () => void
  readonly onDone: () => void
}

export function useDemoTurn() {
  const timers = useRef<number[]>([])

  const cancel = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }, [])

  useEffect(() => cancel, [cancel])

  const at = useCallback((delay: number, work: () => void) => {
    timers.current.push(window.setTimeout(work, delay))
  }, [])

  const run = useCallback(
    ({ modelId, patch, onThinking, onStreaming, onDone }: TurnRun) => {
      const assistantId = newId('msg')
      const trace = demoThinking()
      const reply = demoReply()

      onThinking()

      at(LEAD_IN, () => {
        const assistant: Message = {
          id: assistantId,
          role: 'assistant',
          text: '',
          ...(modelId === null ? {} : { modelId }),
          createdAt: Date.now(),
          thinking: { text: '', seconds: 0 },
        }
        patch((conversation) => ({
          ...conversation,
          messages: [...conversation.messages, assistant],
        }))

        // The trace streams first, so the thinking block fills while it is open
        // and is already complete by the time the reply starts.
        const traceChunks = trace.split(' ')
        const traceEnd = traceChunks.length * THINK_TICK
        traceChunks.forEach((_, index) => {
          const upto = traceChunks.slice(0, index + 1).join(' ')
          at(index * THINK_TICK, () => {
            patch((conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      thinking: {
                        text: upto,
                        seconds: Math.round(((index + 1) * THINK_TICK) / 100) / 10,
                      },
                    }
                  : message,
              ),
            }))
          })
        })

        at(traceEnd, onStreaming)

        const chunks = reply.split(' ')
        for (let index = 0; index < chunks.length; index += STREAM_WORDS) {
          const upto = chunks.slice(0, index + STREAM_WORDS).join(' ')
          const last = index + STREAM_WORDS >= chunks.length
          at(traceEnd + (index / STREAM_WORDS) * STREAM_TICK, () => {
            patch((conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === assistantId ? { ...message, text: upto } : message,
              ),
              updatedAt: Date.now(),
            }))
            if (last) onDone()
          })
        }
      })
    },
    [at],
  )

  return { run, cancel }
}
