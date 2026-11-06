import { useReducedMotion } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'
import { FIRST_SEND_TRAVEL } from '@/design/tokens'
import { firstAdmission, forgetFirstComposerPosition } from '@/features/chat/connection/first-attach'

export function useFirstSendTransition(conversationId: string) {
  const reducedMotion = useReducedMotion()
  const message = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLDivElement>(null)
  const [opening] = useState(() => {
    const admission = firstAdmission(conversationId)
    if (admission?.origin === undefined) return null
    return { conversationId, submissionId: admission.submissionId, origin: admission.origin }
  })
  const arrival = opening?.conversationId === conversationId ? opening : null

  useLayoutEffect(() => {
    if (arrival === null) return
    forgetFirstComposerPosition(conversationId)
    const bubble = message.current
    const field = composer.current
    const row = bubble?.parentElement
    if (reducedMotion || bubble === null || !row || field === null || typeof bubble.animate !== 'function') return

    // Measure the resting layout before either element moves. The draft's
    // first line sits inside the bubble's padding when it takes over.
    const bubbleBounds = bubble.getBoundingClientRect()
    const rowBounds = row.getBoundingClientRect()
    const composerBounds = field.getBoundingClientRect()
    const padding = getComputedStyle(bubble)
    const draftLeft = arrival.origin.draftLeft - Number.parseFloat(padding.paddingLeft)
    const messageLeft = Math.max(rowBounds.left, Math.min(draftLeft, rowBounds.right - bubbleBounds.width))
    const messageTop = arrival.origin.draftTop - Number.parseFloat(padding.paddingTop)
    const move = (element: HTMLElement, x: number, y: number) => element.animate(
      [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
      FIRST_SEND_TRAVEL,
    )
    const messageFlight = move(bubble, messageLeft - bubbleBounds.left, messageTop - bubbleBounds.top)
    const composerFlight = move(field,
      arrival.origin.composerLeft - composerBounds.left,
      arrival.origin.composerTop - composerBounds.top,
    )
    return () => {
      messageFlight.cancel()
      composerFlight.cancel()
    }
  }, [arrival, conversationId, reducedMotion])

  return { message, composer, submissionId: arrival?.submissionId }
}
