import { useCallback, useEffect, useRef } from 'react'
import { SCENE_SCRIPT, SCENE_START, renderScene, type SceneState } from '@/domain/session/gallery/scene'
import { newId } from '@/lib/id'
import type { TurnRun } from '@/stores/workspace/useDemoTurn'
import type { Message } from '@/domain/session/types'

/**
 * The gallery turn: every artifact, resolving on a script.
 *
 * The ordinary demo turn types out a fixed reply, which shows what streaming
 * text looks like and nothing about what an *artifact* looks like while it is
 * still working. That state is most of an artifact's visible life and it is
 * the state with all the moving parts -- the halo, the dots, the timeline
 * resolving a step at a time -- so it needs to be reachable on demand rather
 * than only when a real tool happens to be slow.
 *
 * Each step rewrites the message with the scene at its new state. That is a
 * whole-text replacement rather than an append, which is deliberate and is
 * handled properly downstream: `useSmoothText` sees text that is not a
 * continuation of what it was revealing and settles immediately instead of
 * re-typing the reply, and the segmenter memoises every block whose text did
 * not change, so flipping one artifact from running to done re-renders that
 * artifact and nothing else.
 */
/** The same shape the demo runner takes, so the two are interchangeable. */
export type GalleryOptions = TurnRun

/** How long the model appears to consider before the first card appears. */
const LEAD_IN = 420

export function useGalleryTurn() {
  const timers = useRef<number[]>([])

  const cancel = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }, [])

  // A stray timer that outlives the component keeps calling setState on a dead
  // tree, and cancelling a turn has to actually stop the cards.
  useEffect(() => cancel, [cancel])

  const run = useCallback(
    ({ modelId, patch, onThinking, onStreaming, onDone }: GalleryOptions) => {
      const assistantId = newId('msg')
      onThinking()

      const at = (delay: number, work: () => void) => {
        timers.current.push(window.setTimeout(work, delay))
      }

      const write = (text: string) => {
        patch((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantId ? { ...message, text } : message,
          ),
          updatedAt: Date.now(),
        }))
      }

      at(LEAD_IN, () => {
        const assistant: Message = {
          id: assistantId,
          role: 'assistant',
          text: renderScene(SCENE_START),
          modelId,
          createdAt: Date.now(),
        }
        patch((conversation) => ({
          ...conversation,
          messages: [...conversation.messages, assistant],
        }))
        onStreaming()

        // The state is accumulated rather than recomputed from the script each
        // time, so a step only has to say what changed. Written as a local
        // rather than a ref because a run owns its own timeline -- two runs
        // overlapping would be a bug, and `cancel` prevents it.
        let state: SceneState = SCENE_START

        SCENE_SCRIPT.forEach((step, index) => {
          const last = index === SCENE_SCRIPT.length - 1
          at(step.at, () => {
            state = { ...state, ...step.patch }
            write(renderScene(state))
            if (last) onDone()
          })
        })
      })
    },
    [],
  )

  return { run, cancel }
}
