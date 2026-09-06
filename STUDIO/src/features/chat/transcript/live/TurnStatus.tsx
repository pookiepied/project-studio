import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import { cn } from '@/lib/cn'
import { isTurnRunning, type ConversationPhase } from '@/features/chat/useConversation'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * How long the done beat holds before the pill lets itself fade. Long enough
 * to be seen ending a run the reader may have looked away from; short enough
 * that it never reads as a fixture of the window.
 */
const DONE_HOLD_MS = 3000

/**
 * The turn's status, as a capsule beside the composer.
 *
 * ---- Why it exists --------------------------------------------------------
 *
 * The transcript stays silent until the model gives it something to say, and
 * it should: a row in the content column would be chrome pretending to be
 * content. But the run has states worth naming from outside the content --
 * sent and unanswered, working, finished -- and none of them is visible from
 * everywhere in the window. The ring on the send control says "can stop";
 * this says where the run stands, in words, at the one place the reader
 * already looks when a turn is theirs.
 *
 * ---- The lifecycle --------------------------------------------------------
 *
 * It arrives on the send and holds through the whole run -- the silent gap
 * before any reply ("Sent -- waiting for the model to reply"), then the work
 * itself ("Working on your reply"). When a run it witnessed settles complete,
 * it does not simply vanish: a finished thing disappears anyway, and the
 * disappearance of the status would be the only acknowledgement the run got.
 * It says "Done" instead, holds a beat, and leaves on the same motion it
 * arrived with. Failures and aborts are the connection notice's and the
 * ending line's to speak; the pill stands down for them without a beat. If
 * this capsule ever carries provider errors of its own, that is the seam
 * they enter at -- a fourth state beside these three.
 *
 * ---- The shape ------------------------------------------------------------
 *
 * The PlanPill's shell, for the same reason the plan's pill wears it: one
 * capsule shape above the composer, so status reads as status and never as a
 * fifth kind of card. It is not a control -- nothing here is clickable --
 * so it renders a span where the plan pill renders a button.
 */
export function TurnStatus({ phase, items }: { phase: ConversationPhase; items: readonly TranscriptItem[] }) {
  const running = isTurnRunning(phase)
  const [doneBeat, setDoneBeat] = useState(false)
  const witnessed = useRef(false)

  useEffect(() => {
    if (running) {
      witnessed.current = true
      setDoneBeat(false)
      return
    }
    // Only a run this pill watched gets an ending: a conversation opened
    // after the fact mounts on a settled phase, and confirming a completion
    // nobody here waited through would be the pill inventing an event.
    if (!witnessed.current) return
    witnessed.current = false
    if (phase.status !== 'idle') return
    setDoneBeat(true)
    const timer = window.setTimeout(() => setDoneBeat(false), DONE_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [running, phase])

  const waiting = running && !hasVisibleReply(items)
  // The beat is derived, not just timed: a run arriving under it retakes the
  // pill in the same render its props change, so "Done" never outlives the
  // run it was confirming by even a frame. The effect's own clear is the
  // cleanup, not the switch.
  const showingDone = doneBeat && !running
  const visible = running || showingDone

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div key="turn-status" {...COLLAPSE} className="overflow-hidden">
          <div className="mb-3 flex justify-center">
            <motion.div
              role="status"
              initial={{ opacity: 0, y: 6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.94 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              className={cn(
                'flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1',
                'text-caption text-muted-foreground',
                'border-hairline bg-surface shadow-chip',
              )}
            >
              {showingDone ? (
                <>
                  <span className="shrink-0">
                    <Icons.check size="sm" />
                  </span>
                  <span>Done</span>
                </>
              ) : (
                <>
                  <span className="shrink-0">
                    <StudioMark busy size={14} />
                  </span>
                  <span>{waiting ? 'Sent — waiting for the model to reply' : 'Working on your reply'}</span>
                </>
              )}
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Whether the reply a running turn is producing has put anything on screen
 * yet.
 *
 * The only thing that counts is the newest item: a turn's reply arrives at
 * the tail of the list or not at all, so an assistant message further up is
 * an earlier turn's answer, not this one. An item that draws nothing -- the
 * log opened the message and no delta has landed -- and a user message whose
 * echo is the newest fact both leave this false, which is exactly the gap
 * the waiting wording exists for.
 */
export function hasVisibleReply(items: readonly TranscriptItem[]): boolean {
  const last = items[items.length - 1]
  return last !== undefined && last.kind === 'assistant' && last.segments.length > 0
}
