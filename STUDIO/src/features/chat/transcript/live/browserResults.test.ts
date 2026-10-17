import { describe, expect, it } from 'vitest'
import { present } from '@/platform/harness/contracts/chunks'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { browserResults } from './browserResults'

function call(id: string, text: string, picture = false): ToolCallView {
  return { toolCallId: id, toolName: 'mcp__14_studio-browser__19_studio_browser_open', input: present({}), errorText: null,
    output: present({ content: [{ type: 'text', text }, ...(picture ? [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] : [])] }) }
}
describe('recorded website results', () => {
  it('retains a page screenshot across later text-only calls on the same tab', () => {
    const [page] = browserResults([call('open', 'Tab: one\nURL: https://example.com/\nTitle: Example', true), call('read', 'Tab: one\nRead the page.')])
    expect(page?.frame).toEqual({ kind: 'inline', data: 'AAAA', mimeType: 'image/png' })
    expect(page?.title).toBe('Example')
    expect(page?.steps.map((step) => step.id)).toEqual(['open', 'read'])
  })
  it('does not attach an earlier page screenshot or history to a new URL', () => {
    const [page] = browserResults([call('old', 'Tab: one\nURL: https://example.com/old', true), call('new', 'Tab: one\nURL: https://example.com/new')])
    expect(page?.url).toBe('https://example.com/new')
    expect(page?.frame).toBeNull()
    expect(page?.steps.map((step) => step.id)).toEqual(['new'])
  })
  it('excludes failed and unsafe results and deduplicates URLs across tabs', () => {
    expect(browserResults([call('one', 'Tab: one\nURL: https://example.com'), call('two', 'Tab: two\nURL: https://example.com/'),
      call('unsafe', 'URL: javascript:alert(1)'), { ...call('failed', 'URL: https://failed.com'), errorText: 'Navigation failed' }])
      .map((page) => page.url)).toEqual(['https://example.com/'])
  })
})
