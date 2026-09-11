/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { present } from '@/platform/harness/conversation-chunks'
import { setAttachmentBytesTransport } from '@/platform/harness/attachments'
import type { MediaJob } from '@/platform/harness'
import type { ToolCallView } from '@/features/chat/transcript/projection'

import { ToolGroups } from './ToolGroups'

/**
 * A generation in the transcript: the picture drawn in place from the bytes
 * the harness serves, the prompt as its caption, and a video followed
 * through the media routes until its file lands.
 */

const listed: MediaJob[] = []
const list = vi.fn(async () => ({ ok: true as const, value: listed }))

// One object for the session, as the real store memoises it: a fresh one per
// render would restart the follower's effect on every paint.
const mediaJobs = { list, stop: async () => ({ ok: true as const, value: undefined }) }
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ mediaJobs }) }))

afterEach(() => {
  cleanup()
  setAttachmentBytesTransport(null)
  listed.length = 0
  list.mockClear()
  vi.useRealTimers()
})

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

function call(overrides: Partial<ToolCallView>): ToolCallView {
  return {
    toolCallId: 'call-1',
    toolName: 'studio_image',
    input: present({ prompt: 'a red bicycle' }),
    output: null,
    errorText: null,
    ...overrides,
  }
}

function groups(...calls: ToolCallView[]) {
  return calls.map((one, index) => ({ id: `g-${String(index)}`, calls: [one], file: null }))
}

describe('an image call', () => {
  it('draws the picture from the harness bytes, with the prompt as its caption', async () => {
    const transport = vi.fn(async (path: string) => {
      expect(path).toBe('/api/media/artifacts/conv/media_abc1-1.png')
      return bytesOf('png-bytes')
    })
    setAttachmentBytesTransport(transport)

    render(
      <ToolGroups
        conversationId="conv"
        live={false}
        groups={groups(
          call({
            output: present({
              content: [
                {
                  type: 'text',
                  text: 'Generated 1 image with openai/gpt-image-2.\nArtifact: /api/media/artifacts/conv/media_abc1-1.png (image/png)',
                },
              ],
            }),
          }),
        )}
      />,
    )

    expect(screen.getByText('Generated an image')).toBeTruthy()
    expect(screen.getByText('a red bicycle')).toBeTruthy()
    const image = await screen.findByAltText('a red bicycle')
    expect(image.getAttribute('src')).toBe(`data:image/png;base64,${btoa('png-bytes')}`)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('says it is generating while the call has not answered, and never a broken image', () => {
    render(<ToolGroups conversationId="conv" live groups={groups(call({}))} />)
    expect(screen.getByText('Generating an image')).toBeTruthy()
    expect(screen.getByText('This can take a minute.')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the refusal in the harness\'s words', () => {
    render(
      <ToolGroups
        conversationId="conv"
        live={false}
        groups={groups(call({ errorText: 'No image model is connected. Choose one in Settings - Providers.' }))}
      />,
    )
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText(/Choose one in Settings/)).toBeTruthy()
  })
})

describe('a video call', () => {
  it('follows the job it started and draws the player when the file lands', async () => {
    vi.useFakeTimers()
    setAttachmentBytesTransport(async () => bytesOf('mp4-bytes'))
    listed.push({
      id: 'media_k2x7',
      slot: 'videoGeneration',
      description: 'waves at dusk',
      modelId: 'google/veo-3.1',
      state: 'running',
      detail: 'rendering',
      startedAt: 1,
      endedAt: null,
      outputs: [],
    })

    render(
      <ToolGroups
        conversationId="conv"
        live={false}
        groups={groups(
          call({
            toolName: 'studio_video',
            input: present({ prompt: 'waves at dusk' }),
            output: present('Started video job media_k2x7 with google/veo-3.1. It takes minutes; carry on.'),
          }),
        )}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.getByText('rendering')).toBeTruthy()

    const running = listed[0]
    if (running === undefined) throw new Error('the job was not staged')
    listed[0] = { ...running, state: 'done', endedAt: 9, outputs: [{ fileName: 'media_k2x7-1.mp4', mimeType: 'video/mp4' }] }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(list).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    const video = document.querySelector('video')
    expect(video?.getAttribute('src')).toBe(`data:video/mp4;base64,${btoa('mp4-bytes')}`)

    // Ended: nothing asks again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(list).toHaveBeenCalledTimes(2)
  })
})
