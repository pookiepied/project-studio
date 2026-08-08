/*
 * ============================================================================
 * DEMO — DELETE THIS ENTIRE DIRECTORY WHEN THE HARNESS LANDS.
 * ============================================================================
 *
 * A local stand-in for a real conversation so the composer, transcript,
 * thinking block and streaming can be built and reviewed before the backend
 * exists. It fakes a thinking phase then token streaming with a timer; it talks
 * to nothing.
 *
 * Removal is two steps and leaves no trace:
 *   1. `rm -rf src/features/chat/demo`
 *   2. point `useChatSession` at the real hook
 *
 * The reply is deliberately labelled and obviously synthetic. A leftover should
 * be immediately visible in the UI, not mistaken for a real answer. It does
 * exercise the markdown paths — headings, list, table, code, a long unbroken
 * string — because those are what the layout has to survive.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ChatMessage,
  ChatSession,
  ChatStatus,
  TurnSettings,
} from '@/features/chat/session/types'

const THINKING_MS = 5000
const TOKEN_MS = 16
const CHARS_PER_TICK = 3
/** Cadence of the fake reasoning arriving line by line. */
const THOUGHT_MS = 700

/** Reasoning lines, revealed one at a time so the block visibly fills. */
function demoThoughts(settings: TurnSettings): string[] {
  return [
    `Reading the request. Effort is "${settings.effort}", model is "${settings.modelId}".`,
    'Checking whether a harness is connected — it is not, so nothing can actually run.',
    'Falling back to the layout sample, which is what this demo exists to exercise.',
    'Choosing blocks that stress the transcript: a wide table, a long fenced block, an unbreakable URL.',
    'Emitting the answer.',
  ]
}

function demoAnswer(prompt: string): string {
  return `**[demo]** No harness is connected yet, so nothing ran. Your ${prompt.length}-character message was echoed by a local timer.

### What this sample is for

It exercises the blocks the transcript has to survive:

- ordered and unordered lists
- inline \`code\` and fenced blocks
- tables wider than the column
- unbroken strings

\`\`\`ts
// Wide on purpose: this block must scroll inside itself, never widen the page.
// Long on purpose too — past twenty lines the block offers to collapse itself.
type Offset = string & { readonly __brand: unique symbol }

export interface Envelope {
  readonly id: string
  readonly offset: Offset
  readonly parts: ReadonlyArray<{ type: 'text' | 'reasoning'; text: string }>
}

/** Adds an envelope unless its id is already present, preserving order. */
export function reconcile(previous: ReadonlyArray<Envelope>, incoming: Envelope): ReadonlyArray<Envelope> {
  const index = previous.findIndex((envelope) => envelope.id === incoming.id)
  if (index === -1) return [...previous, incoming]

  const merged = previous.slice()
  merged[index] = { ...previous[index], ...incoming }
  return merged
}

/** Resumes strictly after the supplied offset; never re-reads a delivered batch. */
export async function* follow(from: Offset, signal: AbortSignal): AsyncGenerator<Envelope> {
  let cursor = from
  while (!signal.aborted) {
    const batch = await read(cursor, signal)
    for (const envelope of batch.envelopes) {
      cursor = envelope.offset
      yield envelope
    }
  }
}
\`\`\`

| Surface | Owner | State |
| --- | --- | --- |
| Transcript | frontend | live |
| Streaming | frontend | live |
| Harness | backend | not connected |

A long unbroken string, which must wrap rather than stretch the column:
\`https://example.invalid/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all/to/break/on\`
`
}

export function useDemoChatSession(): ChatSession {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const stream = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (stream.current !== null) {
      clearInterval(stream.current)
      stream.current = null
    }
  }, [])

  // Timers that outlive their component would keep writing to dead state.
  useEffect(() => clearAll, [clearAll])

  const send = useCallback(
    (text: string, settings: TurnSettings) => {
      clearAll()

      const turnId = Date.now()
      const assistantId = `demo-assistant-${turnId}`

      setMessages((current) => [
        ...current,
        { id: `demo-user-${turnId}`, role: 'user', parts: [{ type: 'text', text }] },
        { id: assistantId, role: 'assistant', parts: [] },
      ])
      setStatus('submitting')

      const patch = (parts: ChatMessage['parts']) => {
        setMessages((current) =>
          current.map((message) => (message.id === assistantId ? { ...message, parts } : message)),
        )
      }

      // Phase one: thinking. Lines land one at a time so the block visibly
      // fills rather than appearing complete, which is what a real reasoning
      // stream looks like.
      const thoughts = demoThoughts(settings)
      let thinking = ''

      thoughts.forEach((thought, index) => {
        timers.current.push(
          setTimeout(
            () => {
              setStatus('thinking')
              thinking = thinking ? `${thinking}\n${thought}` : thought
              patch([{ type: 'reasoning', text: thinking }])
            },
            300 + index * THOUGHT_MS,
          ),
        )
      })

      // Phase two: the answer streams in beneath the collapsed reasoning.
      timers.current.push(
        setTimeout(() => {
          setStatus('streaming')
          const answer = demoAnswer(text)
          let cursor = 0

          stream.current = setInterval(() => {
            cursor += CHARS_PER_TICK
            patch([
              { type: 'reasoning', text: thinking },
              { type: 'text', text: answer.slice(0, cursor) },
            ])

            if (cursor >= answer.length) {
              clearAll()
              setStatus('idle')
            }
          }, TOKEN_MS)
        }, THINKING_MS),
      )
    },
    [clearAll],
  )

  const stop = useCallback(() => {
    clearAll()
    setStatus('idle')
  }, [clearAll])

  return { messages, status, send, stop }
}
