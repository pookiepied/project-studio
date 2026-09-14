import { describe, expect, it } from 'vitest'
import { mediaOf, ratioOf } from '@/domain/artifacts/media'

/**
 * The media data reader: every spelling of a ratio becomes a number, and
 * the gallery's one picture and the tool's list of outputs become one list.
 */

describe('a ratio', () => {
  it('is read from the tool spelling, the CSS spelling and exact pixels', () => {
    expect(ratioOf('16:9')).toBeCloseTo(16 / 9)
    expect(ratioOf('16 / 9')).toBeCloseTo(16 / 9)
    expect(ratioOf('4/3')).toBeCloseTo(4 / 3)
    expect(ratioOf('1024x768')).toBeCloseTo(4 / 3)
    expect(ratioOf('1080X1920')).toBeCloseTo(9 / 16)
    expect(ratioOf(1.5)).toBe(1.5)
  })

  it('is null rather than a guess for anything else', () => {
    expect(ratioOf('wide')).toBeNull()
    expect(ratioOf('0:9')).toBeNull()
    expect(ratioOf('')).toBeNull()
    expect(ratioOf(undefined)).toBeNull()
    expect(ratioOf(-2)).toBeNull()
  })
})

describe('the outputs', () => {
  it('are the one picture the gallery spells as url', () => {
    const media = mediaOf({ url: 'data:image/svg+xml,x', aspectRatio: '4 / 3', prompt: 'p', model: 'm' })
    expect(media.outputs).toEqual([{ url: 'data:image/svg+xml,x', ratio: null }])
    expect(media.expected).toBe(1)
    expect(media.ratio).toBeCloseTo(4 / 3)
    expect(media.prompt).toBe('p')
    expect(media.model).toBe('m')
  })

  it('keep a poster as the one thing there is when the clip has not landed', () => {
    const media = mediaOf({ poster: 'data:image/svg+xml,poster' })
    expect(media.outputs).toEqual([{ poster: 'data:image/svg+xml,poster', ratio: null }])
  })

  it('are the listed outputs, each with its own ratio when it names one', () => {
    const media = mediaOf({
      outputs: [
        { path: '/api/media/artifacts/c/media_a-1.png', mimeType: 'image/png' },
        { path: '/api/media/artifacts/c/media_a-2.png', mimeType: 'image/png', aspectRatio: '9:16' },
        { nothing: true },
      ],
      count: 4,
      size: '1024x1024',
    })
    expect(media.outputs).toHaveLength(2)
    expect(media.outputs[0]).toEqual({
      path: '/api/media/artifacts/c/media_a-1.png',
      mimeType: 'image/png',
      ratio: null,
    })
    expect(media.outputs[1]?.ratio).toBeCloseTo(9 / 16)
    // Four were asked for and two have landed: four frames, two of them full.
    expect(media.expected).toBe(4)
    expect(media.ratio).toBe(1)
  })

  it('never expect fewer frames than there are outputs', () => {
    const media = mediaOf({ outputs: [{ url: 'a' }, { url: 'b' }], count: 1 })
    expect(media.expected).toBe(2)
  })

  it('are empty, with one frame expected, when there is nothing', () => {
    const media = mediaOf(undefined)
    expect(media.outputs).toEqual([])
    expect(media.expected).toBe(1)
    expect(media.ratio).toBeNull()
  })
})
