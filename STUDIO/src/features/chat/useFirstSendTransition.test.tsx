/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { forgetFirstAdmission, rememberFirstAdmission } from './connection/first-attach'
import { useFirstSendTransition } from './useFirstSendTransition'

const conversationId = 'cnv_first_send'

afterEach(() => {
  cleanup()
  forgetFirstAdmission(conversationId)
  vi.unstubAllGlobals()
})

it('forms the bubble in place before both elements slide vertically', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  rememberFirstAdmission(conversationId, {
    offset: '1_0',
    submissionId: 'sub_first_send',
    text: 'First draft',
    origin: { composerTop: 390, draftTop: 410 },
  })
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => { cancel: () => void }>(
    () => ({ cancel: vi.fn() }),
  )

  function Fixture() {
    const { message, composer } = useFirstSendTransition(conversationId)
    return (
      <>
        <div ref={(node) => {
          message.current = node
          if (!node) return
          node.getBoundingClientRect = () => new DOMRect(600, 60, 180, 40)
          Object.defineProperty(node, 'animate', { value: animate })
        }} style={{ paddingTop: 12 }}>First draft</div>
        <div ref={(node) => {
          composer.current = node
          if (!node) return
          node.getBoundingClientRect = () => new DOMRect(200, 700, 580, 60)
          Object.defineProperty(node, 'animate', { value: animate })
        }} />
      </>
    )
  }

  render(<Fixture />)
  expect(animate).toHaveBeenCalledTimes(2)
  const [[bubble, bubbleTiming], [composer, composerTiming]] = animate.mock.calls
  expect(bubble.map((frame) => frame.transform)).toEqual([
    'translateY(338px) scale(0.96)', 'translateY(338px)', 'translateY(0)',
  ])
  expect(bubble.map((frame) => frame.opacity)).toEqual([0, 1, 1])
  expect(composer.map((frame) => frame.transform)).toEqual([
    'translateY(-310px)', 'translateY(-310px)', 'translateY(0)',
  ])
  expect(bubbleTiming.duration).toBe(580)
  expect(composerTiming).toEqual(bubbleTiming)
  expect(bubble[1]).toMatchObject({ offset: 160 / 580, easing: composer[1]?.easing })
  expect(composer[1]?.offset).toBe(160 / 580)
})
