import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/conversation-chunks'
import { artifactsIn, mediaKind, readMediaCall } from '@/features/chat/transcript/live/mediaCall'

/**
 * Reading a generation call: which tool it is, the prompt it was given, and
 * the `Artifact:` lines its answer carries - the one shape the harness's
 * media tools promise and this card parses.
 */

describe('recognising a generation call', () => {
  it('knows the two tools under their bare and native-prefixed names', () => {
    expect(mediaKind('studio_image')).toBe('image')
    expect(mediaKind('studio_video')).toBe('video')
    expect(mediaKind('native_studio_image')).toBe('image')
  })

  it('leaves every other tool alone, including the browser', () => {
    expect(mediaKind('read')).toBeNull()
    expect(mediaKind('mcp__14_studio-browser__19_studio_browser_open')).toBeNull()
    expect(mediaKind('studio_images')).toBeNull()
  })
})

describe('the Artifact line', () => {
  it('is read wherever it stands, and nothing that only resembles it is', () => {
    const text = [
      'Generated 2 images with openai/gpt-image-2.',
      'Artifact: /api/media/artifacts/conv-1/media_abc1-1.png (image/png)',
      'Artifact: /api/media/artifacts/conv-1/media_abc1-2.webp (image/webp)',
      'Artifact: ../etc/passwd (text/plain)',
      'Artifact: /api/media/artifacts/conv-1/notes.txt (text/plain)',
    ].join('\n')
    expect(artifactsIn(text)).toEqual([
      { path: '/api/media/artifacts/conv-1/media_abc1-1.png', mimeType: 'image/png' },
      { path: '/api/media/artifacts/conv-1/media_abc1-2.webp', mimeType: 'image/webp' },
    ])
  })
})

describe('the call as the card sees it', () => {
  it('reads the prompt from the input and the outputs from the answer', () => {
    const view = readMediaCall({
      toolCallId: 'call_1',
      toolName: 'studio_image',
      input: present({ prompt: 'a red bicycle', aspect_ratio: '1:1' }),
      output: present({
        content: [
          {
            type: 'text',
            text: 'Generated 1 image with openai/gpt-image-2.\nArtifact: /api/media/artifacts/conv-1/media_abc1-1.png (image/png)',
          },
          { type: 'image', data: 'att_msg_1_0', mimeType: 'image/png' },
        ],
      }),
      errorText: null,
    })
    expect(view).toEqual({
      kind: 'image',
      prompt: 'a red bicycle',
      artifacts: [{ path: '/api/media/artifacts/conv-1/media_abc1-1.png', mimeType: 'image/png' }],
      jobId: null,
    })
  })

  it('reads the job id a video call answered with, before any file exists', () => {
    const view = readMediaCall({
      toolCallId: 'call_2',
      toolName: 'studio_video',
      input: present({ prompt: 'waves at dusk' }),
      output: present('Started video job media_k2x7 with google/veo-3.1. It takes minutes; carry on.'),
      errorText: null,
    })
    expect(view?.kind).toBe('video')
    expect(view?.jobId).toBe('media_k2x7')
    expect(view?.artifacts).toEqual([])
  })

  it('is a running call with nothing yet when the answer has not arrived', () => {
    const view = readMediaCall({
      toolCallId: 'call_3',
      toolName: 'studio_image',
      input: present({ prompt: 'x' }),
      output: null,
      errorText: null,
    })
    expect(view).toEqual({ kind: 'image', prompt: 'x', artifacts: [], jobId: null })
  })
})
