/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { present } from '@/platform/harness/contracts/chunks'
import { setAttachmentBytesTransport } from '@/platform/harness/attachments'
import type { MediaJob } from '@/platform/harness'
import type { ToolCallView } from '@/features/chat/transcript/projection'

import { ToolGroups } from './ToolGroups'

/**
 * A generation in the transcript, drawn as the artifact the gallery draws:
 * the shell's title and status, a frame per picture reserved before any
 * file exists, the picture from the bytes the harness serves, and a video
 * followed through the media routes until its file lands in the player.
 */

const listed: MediaJob[] = []
const list = vi.fn(async () => ({ ok: true as const, value: listed }))

// One object for the session, as the real store memoises it: a fresh one per
// render would restart the follower's effect on every paint.
const mediaJobs = { list, stop: async () => ({ ok: true as const, value: undefined }) }
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ mediaJobs, conversations: [] }),
}))
vi.mock('@/stores/rail', () => ({ useRail: () => ({ openArtifact: () => {} }) }))
vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ route: { kind: 'home' } }) }))

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
  it('draws the picture from the harness bytes under the prompt as its title', async () => {
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

    expect(screen.getByText('a red bicycle')).toBeTruthy()
    expect(screen.getByText('Image ready · openai/gpt-image-2')).toBeTruthy()
    const image = await screen.findByAltText('a red bicycle')
    expect(image.getAttribute('src')).toBe(`data:image/png;base64,${btoa('png-bytes')}`)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('reserves a frame per picture asked for while the call has not answered, and never a broken image', () => {
    render(
      <ToolGroups
        conversationId="conv"
        live
        groups={groups(call({ input: present({ prompt: 'a red bicycle', count: 3, aspect_ratio: '16:9' }) }))}
      />,
    )
    expect(screen.getByText('Generating')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    const frames = document.querySelectorAll('[style*="aspect-ratio"]')
    expect(frames).toHaveLength(3)
    // Every frame is the ratio asked for, before any picture can say otherwise.
    for (const frame of frames) {
      expect((frame as HTMLElement).style.aspectRatio.startsWith(String(16 / 9))).toBe(true)
    }
  })

  it('lays two pictures in one row, each as wide as its ratio', async () => {
    setAttachmentBytesTransport(async () => bytesOf('png-bytes'))
    render(
      <ToolGroups
        conversationId="conv"
        live={false}
        groups={groups(
          call({
            input: present({ prompt: 'two views', count: 2, aspect_ratio: '1:1' }),
            output: present(
              'Generated 2 images with openai/gpt-image-2.\nArtifact: /api/media/artifacts/conv/media_abc1-1.png (image/png)\nArtifact: /api/media/artifacts/conv/media_abc1-2.png (image/png)',
            ),
          }),
        )}
      />,
    )

    const images = await screen.findAllByRole('img')
    expect(images).toHaveLength(2)
    expect(screen.getByText('2 images ready · openai/gpt-image-2')).toBeTruthy()

    // The second picture turns out to be portrait: its cell narrows to its
    // ratio and the row keeps one height, instead of cropping it square.
    const second = images[1] as HTMLImageElement
    Object.defineProperty(second, 'naturalWidth', { value: 900 })
    Object.defineProperty(second, 'naturalHeight', { value: 1600 })
    await act(async () => {
      fireEvent.load(second)
    })
    const cells = [...document.querySelectorAll('[style*="flex-grow"]')] as HTMLElement[]
    expect(cells).toHaveLength(2)
    expect(cells[0]?.style.flexGrow).toBe('1')
    expect(Number(cells[1]?.style.flexGrow)).toBeCloseTo(900 / 1600)
    expect(cells[1]?.style.maxWidth).toBe('min(100%, 270px)')
  })

  it("shows the refusal in the harness's words and no frame", () => {
    render(
      <ToolGroups
        conversationId="conv"
        live={false}
        groups={groups(call({ errorText: 'No image model is connected. Choose one in Settings - Providers.' }))}
      />,
    )
    expect(screen.getByText(/Choose one in Settings/)).toBeTruthy()
    expect(document.querySelector('[style*="aspect-ratio"]')).toBeNull()
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
      detail: 'Rendering frames',
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
    expect(screen.getByText('Rendering frames · google/veo-3.1')).toBeTruthy()

    const running = listed[0]
    if (running === undefined) throw new Error('the job was not staged')
    listed[0] = { ...running, state: 'done', endedAt: 9, outputs: [{ fileName: 'media_k2x7-1.mp4', mimeType: 'video/mp4' }] }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(list).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Video ready · google/veo-3.1')).toBeTruthy()

    // The player arrives on its own chunk; give it a moment to land.
    let video: HTMLVideoElement | null = null
    for (let tries = 0; tries < 20 && video === null; tries += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      video = document.querySelector('video')
    }
    expect(video?.getAttribute('src')).toBe(`data:video/mp4;base64,${btoa('mp4-bytes')}`)
    // The app's own player, not the browser's control strip.
    expect(video?.hasAttribute('controls')).toBe(false)
    expect(document.querySelector('media-controller.studio-player')).not.toBeNull()

    // Ended: nothing asks again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('says the result was not kept when the harness no longer holds the job', async () => {
    render(
      <ToolGroups
        conversationId="conv"
        live={false}
        groups={groups(
          call({
            toolName: 'studio_video',
            input: present({ prompt: 'waves at dusk' }),
            output: present('Started video job media_gone with google/veo-3.1.'),
          }),
        )}
      />,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText(/not kept/)).toBeTruthy()
  })
})
