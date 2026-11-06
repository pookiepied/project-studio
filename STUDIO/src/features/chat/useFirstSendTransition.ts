import { useReducedMotion } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'
import { FIRST_SEND_MOTION } from '@/design/tokens'
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
    if (reducedMotion || bubble === null || field === null || typeof bubble.animate !== 'function') return

    // Measure the resting layout before either element moves. The draft's
    // first line sits inside the bubble's padding when it takes over.
    const bubbleBounds = bubble.getBoundingClientRect()
    const composerBounds = field.getBoundingClientRect()
    const messageTop = arrival.origin.draftTop - Number.parseFloat(getComputedStyle(bubble).paddingTop)
    const messageStart = `translateY(${messageTop - bubbleBounds.top}px)`
    const composerStart = `translateY(${arrival.origin.composerTop - composerBounds.top}px)`
    const { formationMs, travelMs, travelEasing } = FIRST_SEND_MOTION
    const duration = formationMs + travelMs
    const offset = formationMs / duration
    // Both timelines hold their vertical position until the bubble is formed.
    const messageFlight = bubble.animate([
      { transform: `${messageStart} scale(0.96)`, opacity: 0, easing: 'ease-out' },
      { transform: messageStart, opacity: 1, offset, easing: travelEasing },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration })
    const composerFlight = field.animate([
      { transform: composerStart },
      { transform: composerStart, offset, easing: travelEasing },
      { transform: 'translateY(0)' },
    ], { duration })
    return () => {
      messageFlight.cancel()
      composerFlight.cancel()
    }
  }, [arrival, conversationId, reducedMotion])

  return { message, composer, submissionId: arrival?.submissionId }
}
