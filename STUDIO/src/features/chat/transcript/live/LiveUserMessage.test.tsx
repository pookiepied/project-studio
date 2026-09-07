/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveUserMessage } from '@/features/chat/transcript/live/LiveUserMessage'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

/**
 * A sent message's attachments, and the identity they are drawn under.
 *
 * Two pasted screenshots are `image.png` and `image/png` both times, which is
 * an ordinary thing to do and used to collide: the row was keyed on those two
 * facts, React warned about duplicate keys, and one of the pair was free to be
 * dropped or duplicated. Position is the identity here - a sent message's
 * attachment list arrives once with the message and never reorders, grows or
 * shrinks.
 */

function message(
  attachments: readonly { mediaType: string; filename: string | null; size: number | null }[],
): Extract<TranscriptItem, { kind: 'user' }> {
  return {
    kind: 'user',
    id: 'msg_1',
    submissionId: 'sub_1',
    text: 'look at these',
    attachments,
    timestamp: null,
  }
}

const SCREENSHOT = { mediaType: 'image/png', filename: 'image.png', size: 1_024 }

let warnings: string[]

beforeEach(() => {
  warnings = []
  // jsdom has no ResizeObserver; the collapsible body measures its own height.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  // React reports a duplicate key through console.error and renders anyway,
  // so the defect is invisible to an assertion about the output alone.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((entry) => String(entry)).join(' '))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a message carrying attachments', () => {
  it('draws two files that share a name and a type as two rows', () => {
    render(<LiveUserMessage item={message([SCREENSHOT, SCREENSHOT])} />)

    expect(screen.getAllByText('image.png')).toHaveLength(2)
    expect(warnings.filter((line) => line.includes('same key'))).toEqual([])
  })

  it('still names each file it was given', () => {
    render(
      <LiveUserMessage
        item={message([SCREENSHOT, { mediaType: 'image/jpeg', filename: 'holiday.jpg', size: 20 }])}
      />,
    )

    expect(screen.getByText('image.png')).toBeTruthy()
    expect(screen.getByText('holiday.jpg')).toBeTruthy()
  })

  it('falls back to the type for a file that arrived without a name', () => {
    render(<LiveUserMessage item={message([{ ...SCREENSHOT, filename: null }])} />)

    expect(screen.getByText('image/png')).toBeTruthy()
  })
})
