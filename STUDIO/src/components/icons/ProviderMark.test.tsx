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
 * The monogram renders immediately and never depends on the network; the real
 * logo arrives asynchronously from the harness's cache and replaces it without
 * changing what `data-provider` says. No harness means the monogram stays,
 * which is the floor every other test in the suite silently relies on.
 *
 * `data-mark` names which of the three answered — `logo`, `monogram` or
 * `unnamed`. It exists because the element name is not enough to tell them
 * apart: a resolved logo and a monogram are both spans.
 *
 * Colour is deliberately absent from these assertions. Every mark paints
 * `currentColor`, and the rule is asserted once rather than per vendor —
 * see the note on monochrome in `ProviderMark.tsx`.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  resetProviderIconCacheForTests()
})

describe('the mark before a logo arrives', () => {
  it('shows a vendor as its initial when no harness can answer', () => {
    const { container } = render(<ProviderMark provider="the-box-next-door" />)
    const mark = container.querySelector('[data-provider="the-box-next-door"]')
    expect(mark?.getAttribute('data-mark')).toBe('monogram')
    expect(mark?.textContent).toBe('T')
  })

  it('takes the initial from the vendor id, upper-cased', () => {
    const { container } = render(<ProviderMark provider="anthropic" />)
    expect(container.querySelector('[data-provider="anthropic"]')?.textContent).toBe('A')
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

describe('the real logo', () => {
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

    const { container } = render(<ProviderMark provider="deepseek" />)

    // The monogram is on screen first, then the real logo takes its place
    // with the same data-provider value. The logo is a mask, not an image:
    // the source SVGs are monochrome currentColor, so the background is what
    // paints through it.
    expect(container.querySelector('[data-provider="deepseek"]')?.getAttribute('data-mark')).toBe('monogram')
    await waitFor(() => {
      expect(container.querySelector<HTMLSpanElement>('span[data-provider="deepseek"]')?.style.maskImage).toContain(
        'data:image/svg+xml',
      )
    })
    const mark = container.querySelector<HTMLSpanElement>('span[data-provider="deepseek"]')
    expect(mark?.getAttribute('data-mark')).toBe('logo')
    // DeepSeek is the vendor that used to prove the colour table worked here,
    // which makes it the one that proves the table is gone.
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
      vi.fn(async () => new Response(JSON.stringify({ error: 'No provider icon is known for that id.' }), { status: 404 })),
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
})
