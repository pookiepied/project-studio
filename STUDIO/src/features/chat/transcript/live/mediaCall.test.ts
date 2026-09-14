import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { MediaJob } from '@/platform/harness'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import {
  artifactsIn,
  mediaCallArtifact,
  mediaKind,
  readMediaCall,
  titleOf,
} from '@/features/chat/transcript/live/mediaCall'

/**
 * Reading a generation call: which tool it is, what it asked for, the
 * `Artifact:` lines its answer carries - the one shape the harness's media
 * tools promise - and the artifact envelope the transcript draws from it.
 */

function call(overrides: Partial<ToolCallView>): ToolCallView {
  return {
    toolCallId: 'call_1',
    toolName: 'studio_image',
    input: present({ prompt: 'a red bicycle' }),
    output: null,
    errorText: null,
    ...overrides,
  }
}

function job(overrides: Partial<MediaJob>): MediaJob {
  return {
    id: 'media_k2x7',
    slot: 'videoGeneration',
    description: 'waves at dusk',
    modelId: 'google/veo-3.1',
    state: 'running',
    detail: null,
    startedAt: 1,
    endedAt: null,
    outputs: [],
    ...overrides,
  }
}

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

describe('the call as the transcript sees it', () => {
  it('reads what was asked for from the input and the outputs from the answer', () => {
    const view = readMediaCall(
      call({
        input: present({ prompt: 'a red bicycle', aspect_ratio: '1:1', count: 2 }),
        output: present({
          content: [
            {
              type: 'text',
              text: 'Generated 2 images with openai/gpt-image-2.\nArtifact: /api/media/artifacts/conv-1/media_abc1-1.png (image/png)\nArtifact: /api/media/artifacts/conv-1/media_abc1-2.png (image/png)',
            },
            { type: 'image', data: 'att_msg_1_0', mimeType: 'image/png' },
          ],
        }),
      }),
    )
    expect(view).toEqual({
      kind: 'image',
      prompt: 'a red bicycle',
      aspectRatio: '1:1',
      size: null,
      count: 2,
      artifacts: [
        { path: '/api/media/artifacts/conv-1/media_abc1-1.png', mimeType: 'image/png' },
        { path: '/api/media/artifacts/conv-1/media_abc1-2.png', mimeType: 'image/png' },
      ],
      model: 'openai/gpt-image-2',
      jobId: null,
    })
  })

  it('reads the job id and model a video call answered with, before any file exists', () => {
    const view = readMediaCall(
      call({
        toolName: 'studio_video',
        input: present({ prompt: 'waves at dusk' }),
        output: present('Started video job media_k2x7 with google/veo-3.1. It takes minutes; carry on.'),
      }),
    )
    expect(view?.kind).toBe('video')
    expect(view?.jobId).toBe('media_k2x7')
    expect(view?.model).toBe('google/veo-3.1')
    expect(view?.artifacts).toEqual([])
  })

  it('is a running call with nothing yet when the answer has not arrived', () => {
    const view = readMediaCall(call({ input: present({ prompt: 'x' }) }))
    expect(view).toEqual({
      kind: 'image',
      prompt: 'x',
      aspectRatio: null,
      size: null,
      count: 1,
      artifacts: [],
      model: null,
      jobId: null,
    })
  })
})

describe('the title', () => {
  it('is the prompt when the prompt is short', () => {
    expect(titleOf('a red bicycle', 'image')).toBe('a red bicycle')
  })

  it('is the first clause of a long prompt, cut at a break, and says it was cut', () => {
    const prompt =
      'A quiet abstract field, soft light from the upper left, muted blues and warm sand, no text anywhere in the frame.'
    const title = titleOf(prompt, 'image')
    expect(title.length).toBeLessThanOrEqual(73)
    expect(title.endsWith('…')).toBe(true)
    expect(title).toBe('A quiet abstract field, soft light from the upper left…')
  })

  it('names the medium when there was no prompt to name it', () => {
    expect(titleOf(null, 'video')).toBe('A video')
  })
})

describe('the artifact a call becomes', () => {
  it('reserves as many frames as were asked for while the image call runs', () => {
    const unanswered = call({ input: present({ prompt: 'a red bicycle', count: 3, aspect_ratio: '16:9' }) })
    const view = readMediaCall(unanswered)
    if (view === null) throw new Error('not a media call')
    const artifact = mediaCallArtifact(unanswered, view, null, 'conv-1')
    expect(artifact.kind).toBe('image_generation')
    expect(artifact.status).toBe('running')
    expect(artifact.title).toBe('a red bicycle')
    expect(artifact.data).toMatchObject({ count: 3, aspectRatio: '16:9', outputs: [] })
    // The prompt is the title already; it is not repeated as a caption.
    expect(artifact.data?.prompt).toBeUndefined()
  })

  it('is done with its pictures once the image call answers', () => {
    const answered = call({
      output: present(
        'Generated 1 image with openai/gpt-image-2.\nArtifact: /api/media/artifacts/conv-1/media_abc1-1.png (image/png)',
      ),
    })
    const view = readMediaCall(answered)
    if (view === null) throw new Error('not a media call')
    const artifact = mediaCallArtifact(answered, view, null, 'conv-1')
    expect(artifact.status).toBe('done')
    expect(artifact.data).toMatchObject({
      model: 'openai/gpt-image-2',
      outputs: [{ path: '/api/media/artifacts/conv-1/media_abc1-1.png', mimeType: 'image/png' }],
    })
  })

  it('carries the refusal as the failure, over anything else', () => {
    const refused = call({ errorText: 'The image slot is not set.' })
    const view = readMediaCall(refused)
    if (view === null) throw new Error('not a media call')
    const artifact = mediaCallArtifact(refused, view, null, 'conv-1')
    expect(artifact.status).toBe('failed')
    expect(artifact.data?.error).toBe('The image slot is not set.')
  })

  it('follows a video through its job: running with the vendor word, then done with the file', () => {
    const started = call({
      toolName: 'studio_video',
      input: present({ prompt: 'waves at dusk', aspect_ratio: '9:16' }),
      output: present('Started video job media_k2x7 with google/veo-3.1. It takes minutes; carry on.'),
    })
    const view = readMediaCall(started)
    if (view === null) throw new Error('not a media call')

    const waiting = mediaCallArtifact(started, view, null, 'conv-1')
    expect(waiting.kind).toBe('video_generation')
    expect(waiting.status).toBe('running')
    expect(waiting.data).toMatchObject({ model: 'google/veo-3.1', aspectRatio: '9:16' })

    const running = mediaCallArtifact(started, view, job({ detail: 'Rendering frames' }), 'conv-1')
    expect(running.status).toBe('running')
    expect(running.data?.detail).toBe('Rendering frames')

    const done = mediaCallArtifact(
      started,
      view,
      job({ state: 'done', endedAt: 9, outputs: [{ fileName: 'media_k2x7-1.mp4', mimeType: 'video/mp4' }] }),
      'conv-1',
    )
    expect(done.status).toBe('done')
    expect(done.data?.outputs).toEqual([
      { path: '/api/media/artifacts/conv-1/media_k2x7-1.mp4', mimeType: 'video/mp4' },
    ])
  })

  it('says why a video ended badly, in the job words', () => {
    const started = call({
      toolName: 'studio_video',
      input: present({ prompt: 'waves at dusk' }),
      output: present('Started video job media_k2x7 with google/veo-3.1.'),
    })
    const view = readMediaCall(started)
    if (view === null) throw new Error('not a media call')

    const failed = mediaCallArtifact(started, view, job({ state: 'failed', error: 'Safety filter.' }), 'conv-1')
    expect(failed.status).toBe('failed')
    expect(failed.data?.error).toBe('Safety filter.')

    const stopped = mediaCallArtifact(started, view, job({ state: 'stopped' }), 'conv-1')
    expect(stopped.status).toBe('cancelled')

    const forgotten = mediaCallArtifact(started, view, 'unknown', 'conv-1')
    expect(forgotten.status).toBe('cancelled')
    expect(forgotten.data?.error).toMatch(/restarted/)
  })
})
