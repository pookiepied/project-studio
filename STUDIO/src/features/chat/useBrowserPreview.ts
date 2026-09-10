import { useEffect, useRef } from 'react'
import {
  browserAction,
  browserStepOf,
  type BrowserFrame,
  type BrowserStep,
} from '@/features/chat/transcript/live/browserCall'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { useRail } from '@/stores/rail'

/**
 * Keeps the rail's browser preview following the conversation.
 *
 * The transcript row already shows the report where the work happens. This is
 * the other half of ADR 0049 §7: one entry that always holds the *latest*
 * frame and the whole sequence of actions, so a person who wants to watch can
 * open it once and keep watching instead of scrolling after the model.
 *
 * **It never focuses the rail.** A model browsing in the background must not
 * seize a panel somebody is reading — the transcript row is where the work
 * announces itself, and opening the preview is the person's move. What this
 * does is make sure that when they do open it, it is current.
 *
 * Read from the projected transcript rather than from the chunk stream,
 * because the projection is the one place a call and its answer have already
 * been paired. Reading the stream would mean pairing them a second time, in a
 * second way, and the two would eventually disagree.
 *
 * Derived, never stored: every pass rebuilds the whole report from the log —
 * every call, oldest first, plus the newest place and picture — and hands it
 * to the rail as one replacement. Nothing accumulates here between passes, so
 * a reattach or a re-derive cannot double a step, and what the panel shows is
 * always exactly what the log says.
 */
export function useBrowserPreview(
  conversationId: string,
  conversationTitle: string,
  items: readonly TranscriptItem[],
): void {
  const { showBrowser } = useRail()
  // What was last reported, as a signature of the derived report. Without it
  // every transcript chunk - including ones that touch no browser call - would
  // rebuild the report and replace the entry, and every replacement is a state
  // update that re-renders the rail. The signature is content, not identity:
  // the count of settled steps, because a call going from running to answered
  // changes its own step without changing the list's length, and the last
  // call's id, because nothing after it can be new. Settled is the step's own
  // word for it rather than "has a frame or failed": a read-only call answers
  // with words and no picture, and inferring settlement from the picture left
  // the rail reporting that it was still reading a page it had finished
  // reading. The conversation's own id
  // prefixes it, which is what makes a switch away and back report again
  // rather than deciding it was already shown - a different conversation is a
  // different browser.
  const reported = useRef<string | null>(null)

  useEffect(() => {
    const steps = browserStepsOf(items)
    if (steps.length === 0) {
      reported.current = null
      return
    }
    const last = steps[steps.length - 1]
    if (last === undefined) return
    const settled = steps.filter((step) => step.settled).length
    const signature = `${conversationId}:${steps.length}:${settled}:${last.id}`
    if (signature === reported.current) return
    reported.current = signature

    showBrowser(conversationId, conversationTitle, { ...reportOf(steps), steps })
  }, [items, conversationId, conversationTitle, showBrowser])
}

/**
 * Every browser call in the log, oldest first, as the report's step list.
 *
 * A call still running is in the list: the verb arrives in the present tense
 * and its subject is read from the input, so the rail's newest line is what
 * the model is doing while it does it. A call that never answers keeps that
 * line, which is the truth the log carries. An unanswered call contributes no
 * place and no picture - only an answered one can - so the header facts are
 * untouched by it.
 */
function browserStepsOf(items: readonly TranscriptItem[]): readonly BrowserStep[] {
  const steps: BrowserStep[] = []
  for (const item of items) {
    if (item.kind !== 'assistant') continue
    for (const segment of item.segments) {
      if (segment.kind !== 'tools') continue
      for (const group of segment.groups) {
        for (const call of group.calls) {
          if (browserAction(call.toolName) === null) continue
          const step = browserStepOf(call)
          if (step !== null) steps.push(step)
        }
      }
    }
  }
  return steps
}

/**
 * The header's three facts, read newest-first off the derived steps.
 *
 * They are looked for independently because they do not travel together: a
 * click carries the place but rarely a picture, and a read_text carries
 * neither. Whichever call most recently carried each fact is the one the
 * report shows, which is the same reading the transcript's report row makes -
 * one vocabulary, two sizes, and never two answers to "where is it now".
 */
function reportOf(steps: readonly BrowserStep[]): {
  url: string | null
  title: string | null
  frame: BrowserFrame | null
} {
  let url: string | null = null
  let title: string | null = null
  let frame: BrowserFrame | null = null
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step === undefined) continue
    if (url === null && step.url !== null) url = step.url
    if (title === null && step.title !== null) title = step.title
    if (frame === null && step.frame !== null) frame = step.frame
    if (url !== null && title !== null && frame !== null) break
  }
  return { url, title, frame }
}
