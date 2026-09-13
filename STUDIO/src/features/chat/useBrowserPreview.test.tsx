/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { present } from '@/platform/harness/contracts/chunks'
import type {
  ToolCallView,
  TranscriptItem,
} from '@/features/chat/transcript/projection'
import { RailProvider, useRail } from '@/stores/rail/RailProvider'
import { useBrowserPreview } from './useBrowserPreview'

/**
 * The derivation the rail's preview is fed by.
 *
 * Everything the panel will ever show is decided here, once, from the
 * projected transcript: the steps in the order they happened, the newest
 * place, the newest picture. The tests pin the readings a wrong preview would
 * betray - a running call that claims a place it has not reached, a failed
 * call that lends its failure to the frame, a rail that re-renders on every
 * unrelated chunk.
 */

afterEach(cleanup)

function browserCall(id: string, overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: id,
    toolName: 'mcp__14_studio-browser__19_studio_browser_open',
    input: present({ url: 'https://example.com' }),
    output: null,
    errorText: null,
    ...overrides,
  }
}

function assistantWithTools(
  id: string,
  calls: readonly ToolCallView[],
): TranscriptItem {
  return {
    kind: 'assistant',
    id,
    submissionId: `sub_${id}`,
    model: null,
    segments: [{ kind: 'tools', id: `tools_${id}`, groups: [{ id: `g_${id}`, calls, file: null }] }],
    end: { state: 'complete' },
    usage: null,
  }
}

function answeredWith(url: string): ToolCallView['output'] {
  return present({
    content: [
      { type: 'text', text: `Opened.\n\nTab: tab_1\nURL: ${url}\nTitle: Page` },
      {
        type: 'attachment',
        attachment: { id: `att_${url.length}`, mimeType: 'image/jpeg' },
      },
    ],
  })
}

function wrapper({ children }: { children: ReactNode }) {
  return <RailProvider>{children}</RailProvider>
}

describe('deriving the browser report from the transcript', () => {
  /** The hook under test, alongside the rail state it feeds. */
  function usePreview(list: readonly TranscriptItem[]) {
    useBrowserPreview('cnv_1', 'A conversation', list)
    return useRail()
  }

  it('hands the rail every step, oldest first, with the newest place and picture', () => {
    const items = [
      assistantWithTools('msg_1', [
        browserCall('call_1', { output: answeredWith('https://first.example') }),
      ]),
      assistantWithTools('msg_2', [
        browserCall('call_2', {
          toolName: 'mcp__14_studio-browser__19_studio_browser_click',
          input: present({ ref: 'ref_4' }),
          output: present({
            content: [{ type: 'text', text: 'Clicked.\n\nTab: tab_1\nURL: https://second.example' }],
          }),
        }),
      ]),
    ]
    const { result } = renderHook(({ list }) => usePreview(list), { wrapper, initialProps: { list: items } })

    const browser = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (browser?.kind !== 'browser') throw new Error('no browser entry')
    expect(browser.steps.map((step) => step.id)).toEqual(['call_1', 'call_2'])
    expect(browser.steps.map((step) => step.verb)).toEqual(['Opened', 'Clicked'])
    // The header reads newest-first per fact: the click carried a newer place
    // but no picture, so the picture is the screenshot's attachment and the
    // place is the click's URL.
    expect(browser.url).toBe('https://second.example')
    expect(browser.frame).toEqual({
      kind: 'attachment',
      id: `att_${'https://first.example'.length}`,
      mimeType: 'image/jpeg',
    })
  })

  it('keeps a running call in the list without letting it claim a place', () => {
    const items = [
      assistantWithTools('msg_1', [
        browserCall('call_1', { output: answeredWith('https://first.example') }),
        browserCall('call_2', { input: present({ url: 'https://next.example' }) }),
      ]),
    ]
    const { result } = renderHook(({ list }) => usePreview(list), { wrapper, initialProps: { list: items } })

    const browser = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (browser?.kind !== 'browser') throw new Error('no browser entry')
    expect(browser.steps.map((step) => step.verb)).toEqual(['Opened', 'Opening'])
    expect(browser.steps[1]?.url).toBeNull()
    // The place on top is the one the log has actually reported reaching.
    expect(browser.url).toBe('https://first.example')
  })

  it('is silent for a transcript with no browser work at all', () => {
    const items = [assistantWithTools('msg_1', [])]
    const { result } = renderHook(({ list }) => usePreview(list), { wrapper, initialProps: { list: items } })
    expect(result.current.entries).toHaveLength(0)
  })

  it('does not re-report when a chunk touches no browser call', () => {
    // The transcript moves on every token, and the rail re-renders on every
    // replacement; the signature guard is what keeps an unrelated delta from
    // churning an entry whose browser said nothing new.
    const items = [assistantWithTools('msg_1', [browserCall('call_1', { output: answeredWith('https://first.example') })])]
    const { result, rerender } = renderHook(({ list }) => usePreview(list), {
      wrapper,
      initialProps: { list: items },
    })

    const first = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (first?.kind !== 'browser') throw new Error('no browser entry')

    // A new array, same content: exactly what a projection pass produces when
    // the change was somewhere else.
    rerender({ list: [...items] })
    const browser = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (browser?.kind !== 'browser') throw new Error('no browser entry')
    expect(browser.steps).toHaveLength(1)
    // The same object, not a fresh replacement of it: the entry was not
    // re-reported at all, so the rail's strip did not re-render for nothing.
    expect(browser).toBe(first)

    // A second browser call is new work: the report must move.
    const grown = [
      assistantWithTools('msg_1', [
        browserCall('call_1', { output: answeredWith('https://first.example') }),
        browserCall('call_2', { output: answeredWith('https://second.example') }),
      ]),
    ]
    rerender({ list: grown })
    const after = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (after?.kind !== 'browser') throw new Error('no browser entry')
    expect(after.steps).toHaveLength(2)
  })

  it('reports a running call again once it answers, though the count has not moved', () => {
    // The call goes from present tense to past, and from no picture to one,
    // without the list growing - the signature must see that, or the preview
    // freezes on "Opening" forever.
    const running = [assistantWithTools('msg_1', [browserCall('call_1')])]
    const answered = [
      assistantWithTools('msg_1', [browserCall('call_1', { output: answeredWith('https://first.example') })]),
    ]
    const { result, rerender } = renderHook(({ list }) => usePreview(list), {
      wrapper,
      initialProps: { list: running },
    })

    const before = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (before?.kind !== 'browser') throw new Error('no browser entry')
    expect(before.steps[0]?.verb).toBe('Opening')
    expect(before.frame).toBeNull()

    rerender({ list: answered })
    const after = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (after?.kind !== 'browser') throw new Error('no browser entry')
    expect(after.steps[0]?.verb).toBe('Opened')
    expect(after.frame).not.toBeNull()
  })
  it('reports a read-only call once it answers, though it brought no picture', () => {
    // The regression this pins: settlement used to be inferred from the step
    // having a frame or having failed, and the eight read-only tools have
    // neither. A `read_text` that finished still read as "Reading" in the
    // rail, because nothing in the signature had changed when it answered.
    const running = [
      assistantWithTools('msg_1', [
        browserCall('call_1', {
          toolName: 'mcp__14_studio-browser__19_studio_browser_read_text',
          input: present({}),
        }),
      ]),
    ]
    const answered = [
      assistantWithTools('msg_1', [
        browserCall('call_1', {
          toolName: 'mcp__14_studio-browser__19_studio_browser_read_text',
          input: present({}),
          output: present({
            content: [
              {
                type: 'text',
                text: 'Tab: tab_1\nURL: https://first.example\nTitle: Page\n\nThe words on the page.',
              },
            ],
          }),
        }),
      ]),
    ]
    const { result, rerender } = renderHook(({ list }) => usePreview(list), {
      wrapper,
      initialProps: { list: running },
    })

    const before = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (before?.kind !== 'browser') throw new Error('no browser entry')
    expect(before.steps[0]?.verb).toBe('Reading')

    rerender({ list: answered })
    const after = result.current.entries.find((entry) => entry.id === 'browser:cnv_1')
    if (after?.kind !== 'browser') throw new Error('no browser entry')
    expect(after.steps[0]?.verb).toBe('Read')
    // The place it read at is the report's place now, picture or no picture.
    expect(after.url).toBe('https://first.example')
    expect(after.frame).toBeNull()
  })
})
