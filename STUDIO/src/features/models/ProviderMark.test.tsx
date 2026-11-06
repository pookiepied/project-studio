/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { resetProviderIconRequestsForTests } from '@/domain/providers/icons'
import { ProviderMark } from './ProviderMark'

/**
 * The provider mark's two sources, and the handover between them.
 *
 * The monogram renders immediately and never depends on the network; the real
 * logo arrives asynchronously from the harness's cache and replaces it without
 * changing what `data-provider` says. No harness means the monogram stays,
 * which is the floor every other test in the suite silently relies on.
 *
 * `data-mark` names which of the three answered — `logo`, `monogram` or
 * `unnamed`. It exists because the element name is not enough to tell them
 * apart: a resolved logo and a monogram are both spans.
 *
 * Picker marks can use bundled brand assets. Catalog fallbacks keep the
 * theme-colored mask or monogram.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  resetProviderIconRequestsForTests()
})

describe('the mark before a logo arrives', () => {
  it('shows a vendor as its initial when no harness can answer', () => {
    const { container } = render(<ProviderMark provider="the-box-next-door" />)
    const mark = container.querySelector('[data-provider="the-box-next-door"]')
    expect(mark?.getAttribute('data-mark')).toBe('monogram')
    expect(mark?.textContent).toBe('T')
  })

  it('takes the initial from the vendor id, upper-cased', () => {
    const { container } = render(<ProviderMark provider="unlisted-ai" />)
    expect(container.querySelector('[data-provider="unlisted-ai"]')?.textContent).toBe('U')
  })

  it('reports the vendor it was given rather than a bucket', () => {
    // This used to collapse to `custom` for every vendor outside a seven-value
    // union, which threw the answer away exactly where it became interesting:
    // two unrelated labs reported the same mark.
    const { container } = render(<ProviderMark provider="qwen" />)
    expect(container.querySelector('[data-provider="qwen"]')).not.toBeNull()
    expect(container.querySelector('[data-provider="custom"]')).toBeNull()
  })

  it('shows an empty tile when the id has no letter to take', () => {
    // A self-hosted endpoint the catalog has never heard of: `ProvidersPane`
    // passes `catalogProvider ?? ''`, and an empty string has no initial.
    const { container } = render(<ProviderMark provider="" />)
    const mark = container.querySelector('[data-provider=""]')
    expect(mark?.getAttribute('data-mark')).toBe('unnamed')
    expect(mark?.tagName.toLowerCase()).toBe('svg')
  })
})

describe('the tile', () => {
  /**
   * The geometry, which is the whole reason a brand logo is not an icon.
   *
   * A vendor logo carries roughly ten times the detail of a Lucide glyph, so
   * sizing it at `1.1em` like the marks beside it put OpenAI's eight-stroke
   * knot into thirteen pixels, where every stroke lands under one device pixel.
   * The step is its own now, and the tile is what makes a dense logo, a simple
   * one and a fallback letter occupy one slot instead of three shapes.
   */
  it('puts every mark in a tile that is larger than the mark', () => {
    const { container } = render(<ProviderMark provider="anthropic" />)
    const tile = container.firstElementChild as HTMLElement
    const mark = container.querySelector<HTMLElement>('[data-mark]')

    expect(tile.style.width).toBe('var(--provider-tile)')
    expect(mark?.style.width).toBe('var(--provider-mark)')
    // Not `1.1em`: the mark is deliberately no longer sized from its text.
    expect(mark?.style.width).not.toContain('em')
  })

  it('gives the fallback letter the same slot a logo gets', () => {
    // The ragged column is the thing the tile exists to prevent, so the
    // fallback must not opt out of it.
    const { container } = render(<ProviderMark provider="nousresearch" />)
    const tile = container.firstElementChild as HTMLElement
    expect(tile.style.width).toBe('var(--provider-tile)')
    expect(container.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('monogram')
  })
})

describe('the real logo', () => {
  it.each([
    'baseten', 'cerebras', 'cloudflare-workers-ai', 'fireworks', 'groq', 'minimax', 'nvidia',
  ])('bundles the %s color logo', (provider) => {
    const { container } = render(<ProviderMark provider={provider} />)
    expect(container.querySelector('img[data-mark="logo"]')?.getAttribute('src')).toMatch(
      /^(?:data:image\/|\/src\/features\/models\/marks\/)/,
    )
  })

  it.each(['moonshotai', 'openai', 'xai', 'x-ai', 'zai', 'z-ai'])(
    'bundles the %s logo as a theme-colored mask',
    (provider) => {
      const { container } = render(<ProviderMark provider={provider} />)
      const mark = container.querySelector<HTMLElement>('span[data-mark="logo"]')
      expect(mark?.style.maskImage).toContain('data:image/svg+xml')
      expect(mark?.style.backgroundColor).toBe('currentcolor')
    },
  )

  it('uses the same OpenCode marks for Go while keeping their ids distinct', () => {
    const { container, rerender } = render(<ProviderMark provider="opencode" />)
    const standard = [...container.querySelectorAll<HTMLImageElement>('img[data-provider="opencode"]')]
    expect(standard).toHaveLength(2)
    expect(standard[0]?.src).not.toBe(standard[1]?.src)

    rerender(<ProviderMark provider="opencode-go" />)
    const go = [...container.querySelectorAll<HTMLImageElement>('img[data-provider="opencode-go"]')]
    expect(go.map((image) => image.src)).toEqual(standard.map((image) => image.src))
  })

  it('uses the local Google and Claude colors and the theme for OpenAI', () => {
    const { container, rerender } = render(<ProviderMark provider="google" />)
    expect(container.querySelector('img[data-provider="google"]')).not.toBeNull()
    rerender(<ProviderMark provider="anthropic" />)
    expect(container.querySelector('img[data-provider="anthropic"]')).not.toBeNull()
    rerender(<ProviderMark provider="openai" />)
    const mark = container.querySelector<HTMLElement>('[data-provider="openai"][data-mark="logo"]')
    expect(mark?.style.backgroundColor).toBe('currentcolor')
    expect(mark?.style.maskImage).toContain('data:image/svg+xml')
  })

  it('uses both of OpenRouter\'s published theme assets', () => {
    const { container } = render(<ProviderMark provider="openrouter" />)
    const grape = container.querySelector<HTMLImageElement>('img[class~="dark:hidden"]')
    const volt = container.querySelector<HTMLImageElement>('img[class~="dark:block"]')
    expect(grape?.src).toMatch(/7624F4/i)
    expect(volt?.src).toMatch(/C8FF00/i)
  })

  it('replaces the monogram when the harness has one, in the theme colour', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const url = String(input)
        if (url.includes('/api/providers/icons/')) {
          return new Response(JSON.stringify({ svg: '<svg viewBox="0 0 24 24"><circle r="8"/></svg>' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        // Address resolution outside Tauri reads env vars; when they are
        // absent it answers null without a request, so this branch only
        // exists to fail loudly if the resolver asks somewhere unexpected.
        return new Response('{}', { status: 404 })
      }),
    )
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')

    const { container } = render(<ProviderMark provider="model-vendor" />)

    // The monogram is on screen first, then the real logo takes its place
    // with the same data-provider value. The logo is a mask, not an image:
    // the source SVGs are monochrome currentColor, so the background is what
    // paints through it.
    expect(container.querySelector('[data-provider="model-vendor"]')?.getAttribute('data-mark')).toBe('monogram')
    await waitFor(() => {
      expect(container.querySelector<HTMLSpanElement>('span[data-provider="model-vendor"]')?.style.maskImage).toContain(
        'data:image/svg+xml',
      )
    })
    const mark = container.querySelector<HTMLSpanElement>('span[data-provider="model-vendor"]')
    expect(mark?.getAttribute('data-mark')).toBe('logo')
    expect(mark?.style.backgroundColor).toBe('currentcolor')
  })

  it('wears the theme colour for an unknown vendor too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const url = String(input)
        if (url.includes('/api/providers/icons/')) {
          return new Response(JSON.stringify({ svg: '<svg viewBox="0 0 24 24"><circle r="8"/></svg>' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response('{}', { status: 404 })
      }),
    )
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')

    const { container } = render(<ProviderMark provider="some-obscure-vendor" />)
    await waitFor(() => {
      expect(container.querySelector<HTMLSpanElement>('span[data-provider="some-obscure-vendor"]')?.style.maskImage).toContain(
        'data:image/svg+xml',
      )
    })
    // currentColor: the mark inherits whatever the theme says a mark wears.
    expect(container.querySelector<HTMLSpanElement>('span[data-provider="some-obscure-vendor"]')?.style.backgroundColor).toBe(
      'currentcolor',
    )
  })

  it('keeps the monogram when the harness answers that no icon is known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({
        code: 'providers.icons.unknown',
        error: 'No provider icon is known for that id.',
      }, { status: 404 })),
    )
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')

    const { container } = render(<ProviderMark provider="some-obscure-vendor" />)

    // A settled wait: the answer arrives, is cached as "none", and the
    // monogram remains the whole story.
    await waitFor(() => {
      expect(container.querySelector('[data-provider="some-obscure-vendor"]')?.getAttribute('data-mark')).toBe(
        'monogram',
      )
    })
    // The mask path never ran. Asserted on `data-mark` rather than on the
    // element name, which no longer separates them: a monogram is a span too.
    expect(container.querySelector('[data-mark="logo"]')).toBeNull()
  })

  it('refreshes a mounted mark on focus and keeps the old mark during a transport failure', async () => {
    let response: Response | null = Response.json({ svg: '<svg id="first"/>' })
    const fetcher = vi.fn(async () => {
      if (response === null) throw new Error('Harness unavailable')
      return response.clone()
    })
    vi.stubGlobal('fetch', fetcher)
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
    const { container } = render(<ProviderMark provider="a-remote-vendor" />)
    const mask = () => container.querySelector<HTMLElement>('[data-mark="logo"]')?.style.maskImage

    await waitFor(() => expect(mask()).toContain('first'))
    response = null
    await act(async () => { fireEvent.focus(window) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(mask()).toContain('first')

    response = Response.json({ svg: '<svg id="updated"/>' })
    fireEvent.focus(window)
    await waitFor(() => expect(mask()).toContain('updated'))

    response = Response.json({ code: 'providers.icons.unknown', error: 'No icon' }, { status: 404 })
    fireEvent.focus(window)
    await waitFor(() => expect(container.querySelector('[data-mark]')?.getAttribute('data-mark')).toBe('monogram'))
  })

  it('can find a logo after the harness becomes available', async () => {
    const fetcher = vi.fn(async (input: URL | string) => String(input).includes('/api/providers/icons/')
      ? Response.json({ svg: '<svg id="recovered"/>' })
      : new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetcher)
    vi.stubEnv('VITE_HARNESS_BASE_URL', '')
    vi.stubEnv('VITE_HARNESS_TOKEN', '')
    const { container } = render(<ProviderMark provider="a-remote-vendor" />)

    await act(async () => {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-mark="monogram"]')).not.toBeNull()

    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
    fireEvent.focus(window)
    await waitFor(() => {
      expect(container.querySelector<HTMLElement>('[data-mark="logo"]')?.style.maskImage).toContain('recovered')
    })
  })
})
