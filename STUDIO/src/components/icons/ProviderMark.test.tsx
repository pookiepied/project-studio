/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { resetProviderIconCacheForTests } from '@/domain/providers/icons'
import { ProviderMark } from './ProviderMark'

/**
 * The provider mark's two sources, and the handover between them.
 *
 * The drawn marks render immediately and never depend on the network; the
 * real logo arrives asynchronously from the harness's cache and replaces the
 * drawing without changing what `data-provider` says. No harness means the
 * drawing stays, which is the floor every other test in the suite silently
 * relies on.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  resetProviderIconCacheForTests()
})

describe('the drawn marks', () => {
  it('renders a known brand from simple-icons with no harness at all', () => {
    const { container } = render(<ProviderMark provider="anthropic" />)
    const mark = container.querySelector('[data-provider="anthropic"]')
    expect(mark).not.toBeNull()
    expect(mark?.tagName.toLowerCase()).toBe('svg')
  })

  it('falls back to the custom drawing for a vendor with no mark', () => {
    const { container } = render(<ProviderMark provider="the-box-next-door" />)
    expect(container.querySelector('[data-provider="custom"]')).not.toBeNull()
  })
})

describe('the real logo', () => {
  it('replaces the drawing when the harness has one, wearing the vendor brand colour', async () => {
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

    const { container } = render(<ProviderMark provider="deepseek" />)

    // The drawn mark is on screen first, then the real logo takes its place
    // with the same data-provider value. The logo is a mask, not an image:
    // the source SVGs are monochrome currentColor, so the vendor's brand
    // colour is the fill.
    expect(container.querySelector('svg[data-provider="deepseek"]')).not.toBeNull()
    await waitFor(() => {
      expect(container.querySelector<HTMLSpanElement>('span[data-provider="deepseek"]')?.style.maskImage).toContain(
        'data:image/svg+xml',
      )
    })
    const mark = container.querySelector<HTMLSpanElement>('span[data-provider="deepseek"]')
    expect(mark?.style.backgroundColor).toBe('rgb(87, 134, 254)')
  })

  it('wears the theme colour for a vendor with no known brand colour', async () => {
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
      expect(container.querySelector<HTMLSpanElement>('span[data-provider="custom"]')?.style.maskImage).toContain(
        'data:image/svg+xml',
      )
    })
    // currentColor: the mark inherits whatever the theme says a mark wears.
    expect(container.querySelector<HTMLSpanElement>('span[data-provider="custom"]')?.style.backgroundColor).toBe(
      'currentcolor',
    )
  })

  it('keeps the drawing when the harness answers that no icon is known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'No provider icon is known for that id.' }), { status: 404 })),
    )
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')

    const { container } = render(<ProviderMark provider="some-obscure-vendor" />)

    // A settled wait: the answer arrives, is cached as "none", and the
    // drawing remains the whole story.
    await waitFor(() => {
      expect(container.querySelector('svg[data-provider="custom"]')).not.toBeNull()
    })
    expect(container.querySelector('span[data-provider]')?.tagName.toLowerCase()).not.toBe('span')
  })
})
