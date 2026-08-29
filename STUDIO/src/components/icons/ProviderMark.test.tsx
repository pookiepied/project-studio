/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { resetProviderIconCacheForTests } from '@/domain/providers/icons'
import { ProviderMark } from './ProviderMark'

/**
 * The provider mark's sources, and the handover between them.
 *
 * The built-in marks render immediately and never depend on the network; the
 * real logo arrives asynchronously from the harness's cache and replaces them
 * without changing what `data-provider` says. No harness means the built-in
 * mark stays, which is the floor every other test in the suite silently relies
 * on.
 *
 * `data-mark` names which of the four answered — `brand`, `logo`, `monogram`
 * or `unnamed`. It exists because the element name stopped being enough to
 * tell them apart: a resolved logo and a monogram are both spans.
 *
 * Colour is deliberately absent from these assertions now. Every mark paints
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

describe('the built-in marks', () => {
  it('renders a known brand from simple-icons with no harness at all', () => {
    const { container } = render(<ProviderMark provider="anthropic" />)
    const mark = container.querySelector('[data-provider="anthropic"]')
    expect(mark).not.toBeNull()
    expect(mark?.tagName.toLowerCase()).toBe('svg')
    expect(mark?.getAttribute('data-mark')).toBe('brand')
  })

  it('paints a brand path in the theme colour rather than the vendor colour', () => {
    const { container } = render(<ProviderMark provider="deepseek" />)
    // The one assertion the whole monochrome decision rests on. DeepSeek has
    // a Simple Icons hex (#5786FE) and used to wear it here.
    expect(container.querySelector('[data-provider="deepseek"] path')?.getAttribute('fill')).toBe('currentColor')
  })

  it('shows a vendor with no importable logo as its initial', () => {
    const { container } = render(<ProviderMark provider="the-box-next-door" />)
    const mark = container.querySelector('[data-provider="custom"]')
    expect(mark?.getAttribute('data-mark')).toBe('monogram')
    expect(mark?.textContent).toBe('T')
  })

  it('takes the initial from the vendor id, upper-cased', () => {
    const { container } = render(<ProviderMark provider="openai" />)
    expect(container.querySelector('[data-provider="openai"]')?.textContent).toBe('O')
  })

  it('shows an empty tile when the id has no letter to take', () => {
    // A self-hosted endpoint the catalog has never heard of: `ProvidersPane`
    // passes `catalogProvider ?? ''`, and an empty string has no initial.
    const { container } = render(<ProviderMark provider="" />)
    const mark = container.querySelector('[data-provider="custom"]')
    expect(mark?.getAttribute('data-mark')).toBe('unnamed')
    expect(mark?.tagName.toLowerCase()).toBe('svg')
  })
})

describe('the real logo', () => {
  it('replaces the built-in mark when the harness has one, in the theme colour', async () => {
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

    // The built-in mark is on screen first, then the real logo takes its
    // place with the same data-provider value. The logo is a mask, not an
    // image: the source SVGs are monochrome currentColor, so the background
    // is what paints through it.
    expect(container.querySelector('svg[data-provider="deepseek"]')).not.toBeNull()
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
      expect(container.querySelector<HTMLSpanElement>('span[data-provider="custom"]')?.style.maskImage).toContain(
        'data:image/svg+xml',
      )
    })
    // currentColor: the mark inherits whatever the theme says a mark wears.
    expect(container.querySelector<HTMLSpanElement>('span[data-provider="custom"]')?.style.backgroundColor).toBe(
      'currentcolor',
    )
  })

  it('keeps the built-in mark when the harness answers that no icon is known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'No provider icon is known for that id.' }), { status: 404 })),
    )
    vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:4319')
    vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')

    const { container } = render(<ProviderMark provider="some-obscure-vendor" />)

    // A settled wait: the answer arrives, is cached as "none", and the
    // built-in mark remains the whole story.
    await waitFor(() => {
      expect(container.querySelector('[data-provider="custom"]')?.getAttribute('data-mark')).toBe('monogram')
    })
    // The mask path never ran. Asserted on `data-mark` rather than on the
    // element name, which no longer separates them: a monogram is a span too.
    expect(container.querySelector('[data-mark="logo"]')).toBeNull()
  })
})
