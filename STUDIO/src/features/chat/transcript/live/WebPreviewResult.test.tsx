/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '@/lib/clipboard'
import { openExternalUrl } from '@/platform/tauri/external'
import { WebPreviewResult } from './WebPreviewResult'
import { browserResults } from './browserResults'
import { present } from '@/platform/harness/contracts/chunks'

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn().mockResolvedValue(true) }))
vi.mock('@/platform/tauri/external', async (original) => ({ ...await original<typeof import('@/platform/tauri/external')>(), openExternalUrl: vi.fn().mockResolvedValue(undefined) }))
vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const preview = browserResults([{ toolCallId: 'open', toolName: 'studio_browser_open', input: present({}), errorText: null,
  output: present({ content: [{ type: 'text', text: 'Tab: one\nURL: https://example.com/\nTitle: Example' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] }) }])[0]
describe('web preview card', () => {
  it('shows the recorded screenshot and opens the page in the default browser', () => {
    render(<WebPreviewResult preview={preview} conversationId="conv" />)
    expect(screen.getByRole('img', { name: 'Example, website preview' }).getAttribute('src')).toBe('data:image/png;base64,AAAA')
    fireEvent.click(screen.getByRole('button', { name: 'Expand website preview' }))
    expect(openExternalUrl).toHaveBeenCalledWith(preview.url)
  })
  it('offers no in-app preview in the Open in menu', async () => {
    render(<WebPreviewResult preview={preview} conversationId="conv" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in' }))
    await screen.findByRole('menuitem', { name: 'Default browser' })
    expect(screen.queryByRole('menuitem', { name: 'Studio preview' })).toBeNull()
  })
  it('puts external opening and copying in the Open in menu', async () => {
    render(<WebPreviewResult preview={preview} conversationId="conv" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(preview.url))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Link copied')
    fireEvent.click(screen.getByRole('button', { name: 'Open in' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Default browser' }))
    expect(openExternalUrl).toHaveBeenCalledWith(preview.url)
  })
})
