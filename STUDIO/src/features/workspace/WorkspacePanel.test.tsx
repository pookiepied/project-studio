/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePanel } from './WorkspacePanel'
import { WorkspacePanelProvider } from './WorkspacePanelProvider'
import type { TurnChanges } from '@/stores/overview'

const mocks = vi.hoisted(() => {
  const turns: TurnChanges[] = []
  return { locate: vi.fn(), text: vi.fn(), quote: vi.fn(), activity: { turns } }
})
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ locateFile: mocks.locate, readFileText: mocks.text }),
  useOptionalWorkspace: () => null,
}))
vi.mock('@/stores/overview', () => ({ useOverview: () => ({ activity: mocks.activity }) }))
vi.mock('@/platform/tauri/window', () => ({ isTauri: () => false }))
vi.mock('@/platform/tauri/reveal', () => ({ revealPath: vi.fn() }))
vi.mock('@/platform/tauri/files', () => ({ installedEditors: async () => [], openFile: vi.fn(), openInEditor: vi.fn() }))
vi.mock('@/features/chat/composer/drafts', () => ({ writeQuote: mocks.quote }))
vi.mock('@/features/browser/BrowserWindow', () => ({ BrowserWindow: ({ conversationId, embedded }: { conversationId: string; embedded?: boolean }) =>
  <p>{embedded ? 'Embedded' : 'Window'} browser: {conversationId}</p> }))

const found = { ok: true, value: { path: 'C:\\work\\notes.md', kind: 'file', others: 0 } }
const tree = (scope = 'a') => <WorkspacePanelProvider conversationId={scope}><WorkspacePanel /></WorkspacePanelProvider>
const open = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'File path' }), { target: { value: 'notes.md' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
}

beforeEach(() => {
  mocks.activity.turns = []
  mocks.locate.mockResolvedValue(found)
  mocks.text.mockResolvedValue({ ok: true, value: { text: '# Notes\n\nA passage to discuss.', truncated: false } })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); window.getSelection()?.removeAllRanges() })

describe('the central Workspace', () => {
  it('offers the latest surviving files without probing files from old receipts', () => {
    mocks.activity.turns = [
      { id: 'old', at: null, changes: [
        { path: 'gone.md', action: 'Created', calls: [], diff: null },
        { path: 'kept.md', action: 'Created', calls: [], diff: null },
      ] },
      { id: 'new', at: null, changes: [{ path: 'gone.md', action: 'Deleted', calls: [], diff: null }] },
    ]
    render(tree())
    expect(screen.queryByRole('button', { name: 'gone.md' })).toBeNull()
    expect(screen.getByRole('button', { name: 'kept.md' })).toBeTruthy()
    expect(mocks.locate).not.toHaveBeenCalled()
  })
  it('does no lookup until asked, reads the located file, and switches between document and source', async () => {
    const { container } = render(tree())
    expect(mocks.locate).not.toHaveBeenCalled()
    expect(mocks.text).not.toHaveBeenCalled()
    open()
    await screen.findByRole('heading', { name: 'Notes' })
    expect(mocks.locate).toHaveBeenCalledWith('a', 'notes.md')
    expect(mocks.text).toHaveBeenCalledWith('a', 'C:\\work\\notes.md')
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    expect(screen.queryByRole('heading', { name: 'Notes' })).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('# Notes')
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull()
    expect(mocks.text).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show rendered document' }))
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'File path' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New workspace tab' }))
    const newTab = screen.getByRole('tab', { name: 'New tab' })
    expect(document.activeElement).toBe(newTab)
    expect(screen.getByRole('tabpanel', { name: 'New tab' }).contains(screen.getByRole('textbox', { name: 'File path' }))).toBe(true)
  })

  it('refreshes the current file and adds only a requested quotation to chat', async () => {
    render(tree())
    open()
    await screen.findByRole('heading', { name: 'Notes' })
    expect(mocks.quote).not.toHaveBeenCalled()
    const passage = screen.getByText('A passage to discuss.')
    const range = document.createRange()
    range.selectNodeContents(passage)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    expect(screen.queryByText(found.value.path)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discuss file or selected text' }))
    expect(mocks.quote).toHaveBeenCalledWith('a', 'C:\\work\\notes.md\n\nA passage to discuss.')
    mocks.text.mockResolvedValue({ ok: true, value: { text: '# Revised', truncated: false } })
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh file' }))
    await screen.findByRole('heading', { name: 'Revised' })
  })

  it('keeps the document when the interactive browser is opened and closed', async () => {
    render(tree())
    open()
    await screen.findByRole('heading', { name: 'Notes' })
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    fireEvent.click(screen.getByRole('button', { name: 'New workspace tab' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio Browser' }))
    expect(screen.getByText('Embedded browser: a')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Browser' }), { key: 'ArrowLeft', altKey: true })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Browser', 'notes.md'])
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Browser' }), { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Browser' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: 'Show rendered document' })).toBeTruthy()
    expect(mocks.text).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'notes.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'notes.md' }), { key: 'End' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Browser' }), { key: 'Delete' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'notes.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show rendered document' }))
    await screen.findByRole('heading', { name: 'Notes' })
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('reports a missing file without opening a document', async () => {
    mocks.locate.mockResolvedValue({ ok: true, value: null })
    render(tree())
    open()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'File not found in this conversation\'s folders.')
    expect(mocks.text).not.toHaveBeenCalled()
  })

  it('discards a lookup that completes after switching conversations', async () => {
    let complete: (value: typeof found) => void = () => { throw new Error('Lookup did not start') }
    mocks.locate.mockReturnValue(new Promise<typeof found>(resolve => { complete = resolve }))
    const { rerender } = render(tree())
    open()
    await waitFor(() => expect(mocks.locate).toHaveBeenCalled())
    rerender(tree('b'))
    await act(async () => { complete(found) })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(mocks.text).not.toHaveBeenCalled()
    rerender(tree('a'))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(mocks.text).not.toHaveBeenCalled()
  })
})
