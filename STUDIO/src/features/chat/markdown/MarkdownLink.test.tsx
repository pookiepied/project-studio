/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'
import { copyText } from '@/lib/clipboard'
import { openExternalUrl } from '@/platform/tauri/external'

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn().mockResolvedValue(true) }))
vi.mock('@/platform/tauri/external', async (original) => ({
  ...await original<typeof import('@/platform/tauri/external')>(),
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('conversation links', () => {
  it('shows the destination with one Open pill and opens the default browser only on request', async () => {
    const { container } = render(<Markdown text={'Read [the guide](https://example.com/guide "Research guide").'} />)
    const link = screen.getByRole('link', { name: 'the guide' })
    // No href and no title: either one makes the webview draw its own hint.
    expect(link.getAttribute('href')).toBeNull()
    expect(link.getAttribute('title')).toBeNull()
    fireEvent.click(link)
    expect(await screen.findByText('Research guide')).toBeTruthy()
    const open = screen.getByRole('menuitem', { name: 'Open example.com in your browser' })
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(open.textContent).toBe('Open')
    expect(openExternalUrl).not.toHaveBeenCalled()
    expect(container.querySelector('p div')).toBeNull()
    fireEvent.click(open)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/guide')
  })

  it('names an untitled link by its address', async () => {
    render(<Markdown text="[Guide](https://www.example.com/guide/)" />)
    fireEvent.click(screen.getByRole('link', { name: 'Guide' }))
    expect(await screen.findByText('example.com/guide')).toBeTruthy()
  })

  it('gives a citation chip the same capsule, titled by its source', async () => {
    render(<Markdown text={'Supported [1].\n\n**Sources**\n1. W3C, WCAG 2.2. https://www.w3.org/TR/WCAG22'} />)
    const citation = screen.getByRole('link', { name: 'Source 1: w3.org' })
    expect(citation.className).toBe('studio-citation')
    fireEvent.click(citation)
    expect(await screen.findByText('W3C, WCAG 2.2')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open w3.org in your browser' }))
    expect(openExternalUrl).toHaveBeenCalledWith('https://www.w3.org/TR/WCAG22')
  })

  it('offers to copy the link when the browser cannot be opened', async () => {
    vi.mocked(openExternalUrl).mockRejectedValueOnce(new Error('Launch refused'))
    render(<Markdown text="[Guide](https://example.com/guide)" />)
    fireEvent.click(screen.getByRole('link', { name: 'Guide' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open example.com in your browser' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not open your browser')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://example.com/guide'))
  })

  it('never offers an external launch for executable or local-file URLs', () => {
    const { container } = render(<Markdown text={'[Run](javascript:alert%281%29) and [File](file:///C:/private.txt)'} />)
    expect(container.querySelector('a')).toBeNull()
    expect(openExternalUrl).not.toHaveBeenCalled()
  })

  it('retains internal footnote navigation', () => {
    render(<Markdown text="[Note](#note)" />)
    expect(screen.getByRole('link', { name: 'Note' }).getAttribute('href')).toBe('#note')
  })

  it('opens from the keyboard, focuses Open, and returns focus on Escape', async () => {
    render(<Markdown text="[Guide](https://example.com/guide)" />)
    const link = screen.getByRole('link', { name: 'Guide' })
    fireEvent.keyDown(link, { key: 'Enter' })
    const open = await screen.findByRole('menuitem', { name: 'Open example.com in your browser' })
    await waitFor(() => expect(document.activeElement).toBe(open))
    fireEvent.keyDown(open, { key: 'Escape' })
    expect(document.activeElement).toBe(link)
  })
})
