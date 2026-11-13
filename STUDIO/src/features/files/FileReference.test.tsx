/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Markdown } from '@/features/chat/markdown/Markdown'
import { ReplyConversation } from '@/features/chat/markdown/ReplyImage'
import { SheetHostContext } from '@/features/chat/sheet/sheet'
import { ViewerProvider, useViewer } from '@/features/viewer/ViewerProvider'
import { FileReference } from './FileReference'
import { parsePathReference } from './pathReference'

const mocks = vi.hoisted(() => ({
  desktop: false,
  reveal: vi.fn(),
  open: vi.fn(),
  editor: vi.fn(),
  locate: vi.fn(),
  openInSheet: vi.fn(),
  editors: [] as { id: string; label: string }[],
}))

vi.mock('@/platform/tauri/window', () => ({ isTauri: () => mocks.desktop }))
vi.mock('@/platform/tauri/reveal', () => ({ revealPath: (...args: unknown[]) => mocks.reveal(...args) }))
vi.mock('@/platform/tauri/files', () => ({
  openFile: (...args: unknown[]) => mocks.open(...args),
  openInEditor: (...args: unknown[]) => mocks.editor(...args),
  installedEditors: () => Promise.resolve(mocks.editors),
}))
vi.mock('@/stores/workspace', () => ({ useOptionalWorkspace: () => ({ locateFile: mocks.locate }) }))

const found = (path: string, others = 0, kind = 'file') => ({ ok: true, value: { path, kind, others } })
const nothing = { ok: true, value: null }

beforeEach(() => {
  mocks.desktop = true
  mocks.editors = [{ id: 'vscode', label: 'VS Code' }]
  mocks.locate.mockResolvedValue(nothing)
  mocks.reveal.mockResolvedValue(undefined)
  mocks.open.mockResolvedValue(undefined)
  mocks.editor.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

/** Clipboard the menu's Copy path writes to; jsdom has none. */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

/** A reference the test asserts on; a null would be a broken fixture. */
function reference(text: string) {
  const parsed = parsePathReference(text)
  if (parsed === null) throw new Error(`fixture is not a reference: ${text}`)
  return parsed
}

function inConversation(text: string) {
  return (
    <SheetHostContext.Provider value={{ open: mocks.openInSheet }}>
      <ReplyConversation.Provider value="cnv_1">
        <FileReference reference={reference(text)} />
      </ReplyConversation.Provider>
    </SheetHostContext.Provider>
  )
}

const label = (name: string) => screen.getByRole('button', { name })
const menu = () => within(screen.getByRole('menu'))
const rows = () => menu().getAllByRole('menuitem').map((row) => row.textContent)

/** Opens a chip's menu and waits for the lookup and the editor list to land. */
async function openMenu(name: string, lastRow = 'Show in folder') {
  fireEvent.click(label(name))
  await screen.findByRole('menuitem', { name: lastRow })
}

describe('a file reference chip', () => {
  it('opens a referenced document in the central viewer without a chat sheet', async () => {
    function CurrentDocument() {
      const active = useViewer()?.active
      return <output aria-label="Active document">{active?.kind === 'file' ? active.file.path : ''}</output>
    }
    mocks.locate.mockResolvedValue(found('C:\\Work\\chapter.md'))
    render(<ViewerProvider conversationId="cnv_1"><ReplyConversation.Provider value="cnv_1">
      <FileReference reference={reference('chapter.md')} /><CurrentDocument />
    </ReplyConversation.Provider></ViewerProvider>)
    await openMenu('chapter.md')
    fireEvent.click(menu().getByRole('menuitem', { name: 'Preview' }))
    await waitFor(() => expect(screen.getByLabelText('Active document').textContent).toBe('C:\\Work\\chapter.md'))
    expect(mocks.openInSheet).not.toHaveBeenCalled()
  })

  it('does not send a referenced file to another conversation\'s viewer', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\chapter.md'))
    render(<ViewerProvider conversationId="cnv_other"><ReplyConversation.Provider value="cnv_1">
      <FileReference reference={reference('chapter.md')} />
    </ReplyConversation.Provider></ViewerProvider>)
    await openMenu('chapter.md')
    expect(menu().queryByRole('menuitem', { name: 'Preview' })).toBeNull()
  })
  it.each(['workspace/flower.png', 'src/app.ts', 'tools/setup.exe'])(
    'shows a file-type mark on the inline reference %s', (path) => {
      render(<FileReference reference={reference(path)} />)
      expect(label(path).firstElementChild?.classList.contains('studio-icon')).toBe(true)
    },
  )

  it('is one control, with no separate folder button', () => {
    render(<FileReference reference={reference('C:\\Proj\\app.ts')} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('reads nothing from disk until it is clicked', () => {
    render(inConversation('climate-change.md'))
    expect(mocks.locate).not.toHaveBeenCalled()
  })

  it('finds a bare file name through the harness and acts on the real path', async () => {
    const real = 'C:\\Users\\me\\.studio\\data\\conversations\\cnv_1\\workspace\\climate-change.md'
    mocks.locate.mockResolvedValue(found(real))
    render(inConversation('climate-change.md'))
    await openMenu('climate-change.md')
    expect(mocks.locate).toHaveBeenCalledWith('cnv_1', 'climate-change.md')
    await menu().findByRole('menuitem', { name: 'Show in folder' })

    fireEvent.click(menu().getByRole('menuitem', { name: 'Show in folder' }))
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith(real))
  })

  it('never says the folder is unknown', async () => {
    render(inConversation('missing.md'))
    fireEvent.click(label('missing.md'))
    expect(await screen.findByText('Not found in this conversation’s folders.')).toBeTruthy()
    expect(screen.queryByText('Folder unknown.')).toBeNull()
    expect(rows()).toEqual(['Copy name'])
  })

  it('tells a harness that did not answer apart from a missing file', async () => {
    mocks.locate.mockResolvedValue({ ok: false, error: { kind: 'not-reachable', message: 'down' } })
    render(inConversation('notes.md'))
    fireEvent.click(label('notes.md'))
    expect(await screen.findByText(/harness is not responding/)).toBeTruthy()
  })

  it('offers each kind of file what suits it', async () => {
    const cases = [
      ['notes.md', ['Preview', 'Open', 'Open in VS Code', 'Show in folder', 'Copy path']],
      ['chart.png', ['Preview', 'Open', 'Show in folder', 'Copy path']],
      ['clip.mp4', ['Open', 'Show in folder', 'Copy path']],
      ['page.html', ['Preview', 'Open in browser', 'Open in VS Code', 'Show in folder', 'Copy path']],
      ['app.py', ['Preview', 'Open in VS Code', 'Show in folder', 'Copy path']],
      ['setup.exe', ['Show in folder', 'Copy path']],
      ['.env.local', ['Open in VS Code', 'Show in folder', 'Copy path']],
    ] as const
    for (const [name, expected] of cases) {
      mocks.locate.mockResolvedValue(found(`C:\\Work\\${name}`))
      render(inConversation(`src/${name}`))
      await openMenu(`src/${name}`)
      await waitFor(() => expect(rows()).toEqual(expected))
      cleanup()
    }
  })

  it('never offers to open a program or a script', async () => {
    for (const name of ['setup.exe', 'run.bat', 'run.ps1', 'run.js', 'run.py']) {
      mocks.locate.mockResolvedValue(found(`C:\\Work\\${name}`))
      render(inConversation(`src/${name}`))
      await openMenu(`src/${name}`)
      expect(menu().queryByRole('menuitem', { name: 'Open' })).toBeNull()
      cleanup()
    }
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('reads a located folder as a folder', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\src', 0, 'folder'))
    render(inConversation('src/'))
    await openMenu('src/', 'Open in File Explorer')
    expect(rows()).toEqual(['Open in VS Code', 'Open in File Explorer', 'Copy path'])
  })

  it('carries a line to the editor', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\app.ts'))
    render(inConversation('src/app.ts:42:7'))
    await openMenu('src/app.ts:42:7')
    expect(menu().getByText('Line 42, column 7')).toBeTruthy()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in VS Code' }))
    await waitFor(() => expect(mocks.editor).toHaveBeenCalledWith('vscode', 'C:\\Work\\app.ts', 42, 7))
  })

  it('previews in the sheet over the transcript', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\notes.md'))
    render(inConversation('notes.md'))
    await openMenu('notes.md')
    fireEvent.click(menu().getByRole('menuitem', { name: 'Preview' }))
    await waitFor(() => expect(mocks.openInSheet).toHaveBeenCalledWith({ kind: 'file', conversationId: 'cnv_1', file: expect.objectContaining({ path: 'C:\\Work\\notes.md' }) }))
  })

  it('says when the name fit more than one file', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\notes.md', 2))
    render(inConversation('notes.md'))
    await openMenu('notes.md')
    expect(menu().getByText('Newest of 3 files with this name.')).toBeTruthy()
  })

  it('still acts on a full path the harness does not recognise, without a preview', async () => {
    render(inConversation('D:\\Elsewhere\\report.pdf'))
    await openMenu('D:\\Elsewhere\\report.pdf')
    expect(rows()).toEqual(['Open', 'Show in folder', 'Copy path'])
    fireEvent.click(menu().getByRole('menuitem', { name: 'Open' }))
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith('D:\\Elsewhere\\report.pdf'))
  })

  it('keeps a network path copyable and nothing more', async () => {
    render(inConversation('\\\\server\\share\\report.pdf'))
    fireEvent.click(label('\\\\server\\share\\report.pdf'))
    expect(await screen.findByText('This path is on another computer.')).toBeTruthy()
    expect(rows()).toEqual(['Copy name'])
    expect(mocks.locate).not.toHaveBeenCalled()
  })

  it('offers no desktop verbs in a browser tab', async () => {
    mocks.desktop = false
    mocks.locate.mockResolvedValue(found('C:\\Work\\notes.md'))
    render(inConversation('notes.md'))
    fireEvent.click(label('notes.md'))
    await screen.findByRole('menuitem', { name: 'Preview' })
    expect(rows()).toEqual(['Preview', 'Copy path'])
  })

  it('shows a native refusal in the menu and keeps it open', async () => {
    mocks.open.mockRejectedValue('Windows could not open this file.')
    render(inConversation('D:\\Elsewhere\\report.pdf'))
    await openMenu('D:\\Elsewhere\\report.pdf')
    fireEvent.click(menu().getByRole('menuitem', { name: 'Open' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Windows could not open this file.')
    expect(menu().getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
  })

  it('does not show a raw error, which could carry a private path', async () => {
    mocks.reveal.mockRejectedValue(new Error('OS failure with private path'))
    render(inConversation('D:\\Elsewhere\\report.pdf'))
    await openMenu('D:\\Elsewhere\\report.pdf')
    fireEvent.click(menu().getByRole('menuitem', { name: 'Show in folder' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Show in folder did not work.')
  })

  it('offers the file without printing its path', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\notes.md'))
    render(inConversation('notes.md'))
    await openMenu('notes.md')
    await menu().findByRole('menuitem', { name: 'Copy path' })
    expect(screen.queryByText('C:\\Work\\notes.md')).toBeNull()
  })

  it('marks an editor row with that editor\'s own logo', async () => {
    mocks.locate.mockResolvedValue(found('C:\\Work\\notes.md'))
    render(inConversation('notes.md'))
    await openMenu('notes.md')
    const row = await menu().findByRole('menuitem', { name: 'Open in VS Code' })
    expect(row.querySelector('.studio-mark-editorVsCode')).not.toBeNull()
  })

  it('copies the real path and says so', async () => {
    const writeText = stubClipboard()
    mocks.locate.mockResolvedValue(found('C:\\Work\\notes.md'))
    render(inConversation('notes.md'))
    await openMenu('notes.md')
    fireEvent.click(menu().getByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('C:\\Work\\notes.md'))
    expect(await screen.findByRole('menuitem', { name: 'Copied' })).toBeTruthy()
  })

  it('asks again in another conversation rather than reusing an answer', async () => {
    mocks.locate.mockResolvedValue(found('C:\\One\\notes.md'))
    const view = render(inConversation('notes.md'))
    await openMenu('notes.md')
    mocks.locate.mockResolvedValue(found('C:\\Two\\notes.md'))
    view.rerender(
      <ReplyConversation.Provider value="cnv_2"><FileReference reference={reference('notes.md')} /></ReplyConversation.Provider>,
    )
    await openMenu('notes.md')
    expect(mocks.locate).toHaveBeenLastCalledWith('cnv_2', 'notes.md')
    fireEvent.click(await menu().findByRole('menuitem', { name: 'Show in folder' }))
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('C:\\Two\\notes.md'))
  })

  it('keeps the reference as written, suffix and all', () => {
    const { container } = render(<FileReference reference={reference('C:\\Proj\\app.ts:42:7')} />)
    expect(container.querySelector('code.studio-file-reference')?.textContent).toBe('C:\\Proj\\app.ts:42:7')
  })

  it('closes on Escape and keeps the menu inside the window for a long path', async () => {
    const longPath = `C:\\${'directory-with-a-long-name\\'.repeat(20)}report.pdf`
    const { container } = render(<FileReference reference={reference(longPath)} />)
    fireEvent.click(label(longPath))
    await screen.findByRole('menuitem', { name: 'Copy path' })
    expect(screen.getByRole('menu').style.maxWidth).toMatch(/^\d+px$/)
    expect(menu().queryByText(longPath)).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('waits for the reply to finish before anything is interactive', () => {
    const view = render(<Markdown text={'Saved to `C:\\Proj\\chart.png`.'} streaming />)
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
    expect(view.container.querySelector('code.studio-file-reference')?.textContent).toBe('C:\\Proj\\chart.png')
    expect(view.container.querySelector('code.studio-file-reference svg.lucide-photo-rounded')).not.toBeNull()
    view.rerender(<Markdown text={'Saved to `C:\\Proj\\chart.png`.'} />)
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
    expect(mocks.reveal).not.toHaveBeenCalled()
    expect(mocks.locate).not.toHaveBeenCalled()
  })

  it('leaves a command line and a web link exactly as they were', () => {
    const { container } = render(
      <Markdown text={'Run `C:\\Apps\\Studio.exe --flag` or see [Studio](https://example.com).'} />,
    )
    expect(container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
    expect(container.querySelector('code.studio-file-reference')).toBeNull()
    expect(container.querySelector('a.studio-link')).not.toBeNull()
  })

  it('turns a local markdown link into the same reference', () => {
    const { container } = render(<Markdown text="See [the notes](docs/readme.md) for details." />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('code.studio-file-reference')?.textContent).toBe('docs/readme.md')
    expect(container.querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
  })

  it.each([
    '[notes][source]\n\n[source]: docs/readme.md',
    '[notes](docs/My%20Report.pdf)',
  ])('supports Markdown reference links and encoded destinations: %s', (text) => {
    const { container } = render(<Markdown text={text} />)
    const path = text.includes('%20') ? 'docs/My Report.pdf' : 'docs/readme.md'
    expect(container.querySelector('code.studio-file-reference')?.textContent).toBe(path)
  })

  it.each([
    '[notes](docs/readme.md)',
    '```ts:src/app.ts\nconst a = 1\n```',
  ])('keeps every path surface passive during streaming: %s', (text) => {
    const view = render(<Markdown text={text} streaming />)
    expect(view.container.querySelector('[aria-haspopup="menu"]')).toBeNull()
    view.rerender(<Markdown text={text} />)
    expect(view.container.querySelector('[aria-haspopup="menu"]')).not.toBeNull()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('keeps code inside a web link passive and opens only the web panel', () => {
    const { container } = render(<Markdown text={'[`docs/readme.md`](https://example.com)'} />)
    const link = screen.getByRole('link')
    expect(link.querySelector('button')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('docs/readme.md')
    fireEvent.click(link)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(mocks.reveal).not.toHaveBeenCalled()
  })
})
