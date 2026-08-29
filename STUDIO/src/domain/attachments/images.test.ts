import { describe, expect, it } from 'vitest'

import {
  MAX_IMAGES_PER_TURN,
  MAX_IMAGE_BYTES,
  pickImageFiles,
  readImageFile,
  sniffImageMime,
  visionRefusal,
} from './images'
import type { ModelCapability } from '@/platform/harness'
import type { CatalogModel } from '@/domain/models/catalog'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('sniffImageMime reads headers, not names', () => {
  it('knows the four formats by their magic bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/jpeg',
    )
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/gif',
    )
    expect(
      sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe('image/webp')
  })

  it('refuses anything else, including text renamed to .png', () => {
    expect(sniffImageMime(new Uint8Array([0x23, 0x20, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0a]))).toBeNull()
    expect(sniffImageMime(new Uint8Array([0x89, 0x50]))).toBeNull()
  })
})

describe('pickImageFiles judges before a byte is read', () => {
  const file = (name: string, type: string, size: number): File =>
    ({ name, type, size } as unknown as File)

  it('accepts the four formats and refuses the rest with a reason', () => {
    const { accepted, rejections } = pickImageFiles([
      file('a.png', 'image/png', 10),
      file('a.jpg', 'image/jpeg', 10),
      file('a.webp', 'image/webp', 10),
      file('a.gif', 'image/gif', 10),
      file('movie.mp4', 'video/mp4', 10),
    ])
    expect(accepted).toHaveLength(4)
    expect(rejections).toEqual([
      { filename: 'movie.mp4', reason: 'Images only (PNG, JPEG, WebP, or GIF).' },
    ])
  })

  it('refuses files past ten megabytes', () => {
    const { accepted, rejections } = pickImageFiles([
      file('big.png', 'image/png', MAX_IMAGE_BYTES + 1),
    ])
    expect(accepted).toHaveLength(0)
    expect(rejections[0].reason).toBe('Over 10 MB — too large to send.')
  })

  it('caps a turn at five images, counting what the composer already holds', () => {
    const haul = Array.from({ length: MAX_IMAGES_PER_TURN + 2 }, (_, at) =>
      file(`p${at}.png`, 'image/png', 10),
    )
    const { accepted, rejections } = pickImageFiles(haul, 3)
    // Room for two past the three held; the other five are named in the rejections.
    expect(accepted.map((entry) => entry.name)).toEqual(['p0.png', 'p1.png'])
    expect(rejections).toHaveLength(5)
    expect(rejections[0].reason).toBe('A turn carries at most 5 images.')
  })
})

describe('readImageFile trusts the header over the label', () => {
  /** Only the three members readImageFile consumes, so the test runs where the File global does not. */
  const fileLike = (name: string, bytes: Uint8Array): File =>
    ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteLength) }) as unknown as File

  it('encodes a real PNG into the submission shape', async () => {
    const wire = await readImageFile(fileLike('shot.png', PNG))
    expect(wire).toEqual({
      type: 'image',
      data: btoa(String.fromCharCode(...PNG)),
      mimeType: 'image/png',
      filename: 'shot.png',
    })
  })

  it('refuses a text file wearing a .png name', async () => {
    const wire = await readImageFile(
      fileLike('lies.png', new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])),
    )
    expect('type' in wire ? null : wire.reason).toContain('Not a readable image')
  })
})

describe('visionRefusal speaks before the provider does', () => {
  const capability = (vision: ModelCapability['vision']): ModelCapability => ({
    textGeneration: 'supported',
    streaming: 'supported',
    reasoning: 'unsupported',
    toolCalling: 'supported',
    vision,
    embeddings: 'unsupported',
    reranking: 'unsupported',
    imageGeneration: 'unsupported',
    imageEditing: 'unsupported',
    videoGeneration: 'unsupported',
    speechGeneration: 'unsupported',
    transcription: 'unsupported',
    webSearch: 'unsupported',
    webFetch: 'unsupported',
    contextWindow: 'unknown',
    maxOutputTokens: 'unknown',
  })
  const blind: CatalogModel = {
    id: 'openai/gpt-3.5-turbo',
    connectionId: 'work',
    modelId: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    author: 'openai',
    connectionVendor: 'openai',
    connectionName: 'Work OpenAI',
    reasoningLevels: [],
    contextWindow: 16385,
    capability: capability('unsupported'),
    pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const seer: CatalogModel = { ...blind, id: 'anthropic/claude', capability: capability('supported') }
  const models: readonly CatalogModel[] = [blind, seer]

  it('refuses a known blind model, naming it', () => {
    const refusal = visionRefusal('openai/gpt-3.5-turbo', 1, models)
    expect(refusal?.kind).toBe('rejected')
    expect(refusal !== null && refusal.message.includes('GPT-3.5 Turbo')).toBe(true)
  })

  it('says nothing about a model that can see, the default, or a turn without images', () => {
    expect(visionRefusal('anthropic/claude', 2, models)).toBeNull()
    expect(visionRefusal(null, 1, models)).toBeNull()
    expect(visionRefusal('openai/gpt-3.5-turbo', 0, models)).toBeNull()
  })
})
