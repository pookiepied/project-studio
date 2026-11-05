/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Markdown } from '@/features/chat/markdown/Markdown'
import { FileReference } from './FileReference'
import { parsePathReference } from './pathReference'
import { ReplyConversation } from './ReplyImage'

const mocks = vi.hoisted(() => ({
  desktop: false,
  reveal: vi.fn(),
  workspaceRoot: null as string | null,
  pickDirectory: vi.fn(),
}))

vi.mock('@/platform/tauri/window', () => ({ isTauri: () => mocks.desktop, pickDirectory: () => mocks.pickDirectory() }))
vi.mock('@/platform/tauri/reveal', () => ({ revealPath: (...args: unknown[]) => mocks.reveal(...args) }))
vi.mock('./useWorkspaceRoot', () => ({ useConversationWorkspaceRoot: () => mocks.workspaceRoot }))

afterEach(() => {
  cleanup()
  mocks.desktop = false
  mocks.workspaceRoot = null
  mocks.reveal.mockReset()
  mocks.pickDirectory.mockReset()
  vi.restoreAllMocks()
})

/** Clipboard the panel's Copy path writes to; jsdom has none. */
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

/** The chip's label, by its own text - which is the reply's own words. */
function label(name: string) {
  return screen.getByRole('button', { name })
}

/** The open panel, portaled to the body like every popover here. */
function panel() {
  return within(screen.getByRole('menu'))
}

describe('a file reference chip', () => {
  it('keeps the reference as written and opens the panel with the resolved path', () => {
    const { container } = render(
      <FileReference reference={reference('C:\\Proj\\app.ts:42:7')} />,
    )
    // The chip is the reply's own words, suffix and all, on the same code
    // element inline references have always rendered.
    expect(container.querySelector('code.studio-file-reference')?.textContent).toBe('C:\\Proj\\app.ts:42:7')
    fireEvent.click(label('C:\\Proj\\app.ts:42:7'))
    expect(panel().getByText('C:\\Proj\\app.ts')).toBeTruthy()
    expect(panel().getByText('Line 42, column 7')).toBeTruthy()
  })

  it('copies the path from the panel and says so', async () => {
    const writeText = stubClipboard()
    render(<FileReference reference={reference('C:\\Proj\\app.ts')} />)
    fireEvent.click(label('C:\\Proj\\app.ts'))
    fireEvent.click(panel().getByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('C:\\Proj\\app.ts'))
    expect(panel().getByRole('menuitem', { name: 'Copied' })).toBeTruthy()
  })

  it('reveals the resolved path on the folder mark and closes on success', async () => {
    mocks.desktop = true
    mocks.reveal.mockResolvedValue(undefined)
    render(<FileReference reference={reference('C:\\Proj\\app.ts')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show C:\\Proj\\app.ts in File Explorer' }))
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('C:\\Proj\\app.ts'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('reports a missing path in the panel and keeps Copy path available', async () => {
    mocks.desktop = true
    mocks.reveal.mockRejectedValue('Path not found.')
    render(<FileReference reference={reference('C:\\Proj\\app.ts')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show C:\\Proj\\app.ts in File Explorer' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Path not found.')
    // The verbs that still work are still there: a missing path takes away
    // nothing except the navigation that failed.
    expect(panel().getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(panel().getByRole('menuitem', { name: 'Show in File Explorer' })).toBeTruthy()
  })

  it('does not claim a desktop it does not have', async () => {
    // Browser-only: no folder mark, an honest note, and the details and the
    // copy exactly where they were.
    const writeText = stubClipboard()
    render(<FileReference reference={reference('C:\\Proj\\app.ts')} />)
    expect(screen.queryByRole('button', { name: 'Show C:\\Proj\\app.ts in File Explorer' })).toBeNull()
    fireEvent.click(label('C:\\Proj\\app.ts'))
    expect(panel().getByText('Opening File Explorer needs the Studio desktop app.')).toBeTruthy()
    expect(panel().queryByRole('menuitem', { name: 'Show in File Explorer' })).toBeNull()
    fireEvent.click(panel().getByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('C:\\Proj\\app.ts'))
  })

  it('explains a network path instead of probing it', () => {
    mocks.desktop = true
    const { container } = render(
      <FileReference reference={reference('\\\\server\\share\\file.txt')} />,
    )
    expect(container.querySelector('code.studio-file-reference')?.textContent).toBe('\\\\server\\share\\file.txt')
    expect(container.querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(label('\\\\server\\share\\file.txt'))
    expect(panel().getByText('That path is on another computer, so it cannot be shown here.')).toBeTruthy()
  })

  it('resolves a relative reference against its conversation workspace', async () => {
    mocks.desktop = true
    mocks.reveal.mockResolvedValue(undefined)
    mocks.workspaceRoot = 'C:\\Work\\Proj'
    render(<FileReference reference={reference('docs/readme.md')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show docs/readme.md in File Explorer' }))
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('C:\\Work\\Proj\\docs\\readme.md'))
  })

  it('says what is missing when a relative reference has no workspace', () => {
    mocks.desktop = true
    render(<FileReference reference={reference('docs/readme.md')} />)
    fireEvent.click(label('docs/readme.md'))
    expect(panel().getByText('The folder this relative path belongs to is not known here.')).toBeTruthy()
    expect(panel().getByText('docs/readme.md')).toBeTruthy()
  })

  it('lets a person choose a base folder when the conversation has none', async () => {
    mocks.desktop = true
    mocks.pickDirectory.mockResolvedValue('C:\\Chosen Folder')
    mocks.reveal.mockResolvedValue(undefined)
    render(<FileReference reference={reference('docs/readme.md')} />)
    fireEvent.click(label('docs/readme.md'))
    fireEvent.click(panel().getByRole('menuitem', { name: 'Choose base folder' }))
    await waitFor(() => expect(panel().getByText('C:\\Chosen Folder\\docs\\readme.md')).toBeTruthy())
    expect(mocks.reveal).not.toHaveBeenCalled()
    fireEvent.click(panel().getByRole('menuitem', { name: 'Show in File Explorer' }))
    await waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith('C:\\Chosen Folder\\docs\\readme.md'))
  })

  it('keeps an unresolved reference unchanged when the folder picker is cancelled', async () => {
    mocks.desktop = true
    mocks.pickDirectory.mockResolvedValue(null)
    render(<FileReference reference={reference('docs/readme.md')} />)
    fireEvent.click(label('docs/readme.md'))
    fireEvent.click(panel().getByRole('menuitem', { name: 'Choose base folder' }))
    await waitFor(() => expect(mocks.pickDirectory).toHaveBeenCalledTimes(1))
    expect(panel().queryByRole('menuitem', { name: 'Show in File Explorer' })).toBeNull()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('does not carry a chosen base folder into another conversation', async () => {
    mocks.desktop = true
    mocks.pickDirectory.mockResolvedValue('C:\\Chosen')
    const view = render(<ReplyConversation.Provider value="one"><FileReference reference={reference('docs/readme.md')} /></ReplyConversation.Provider>)
    fireEvent.click(label('docs/readme.md'))
    fireEvent.click(panel().getByRole('menuitem', { name: 'Choose base folder' }))
    await waitFor(() => expect(panel().getByText('C:\\Chosen\\docs\\readme.md')).toBeTruthy())
    view.rerender(<ReplyConversation.Provider value="two"><FileReference reference={reference('docs/readme.md')} /></ReplyConversation.Provider>)
    expect(screen.queryByRole('button', { name: /File Explorer/ })).toBeNull()
  })

  it('reports a folder picker failure without losing the copy action', async () => {
    mocks.desktop = true
    mocks.pickDirectory.mockRejectedValue(new Error('OS failure with private path'))
    render(<FileReference reference={reference('docs/readme.md')} />)
    fireEvent.click(label('docs/readme.md'))
    fireEvent.click(panel().getByRole('menuitem', { name: 'Choose base folder' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The folder picker could not be opened.')
    expect(panel().getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
  })

  it('closes on Escape and keeps the panel inside the window for a long path', () => {
    const longPath = `C:\\${'directory-with-a-long-name\\'.repeat(20)}report.pdf`
    const { container } = render(<FileReference reference={reference(longPath)} />)
    fireEvent.click(label(longPath))
    const surface = screen.getByRole('menu')
    expect(surface.className).toContain('max-w-[min(24rem,calc(100vw-1rem))]')
    expect(panel().getByText(longPath).className).toContain('break-all')
    fireEvent.keyDown(document, { key: 'Escape' })
    // The dismissal is the trigger's state change; the panel's exit animation
    // unmounting is the Popover's own tested behaviour, not this one's.
    expect(container.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('waits for the reply to finish before anything is interactive', () => {
    const view = render(<Markdown text={'Saved to `C:\\Proj\\chart.png`.'} streaming />)
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
    expect(view.container.querySelector('code.studio-file-reference')?.textContent).toBe('C:\\Proj\\chart.png')
    view.rerender(<Markdown text={'Saved to `C:\\Proj\\chart.png`.'} />)
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
    // Streaming rendered the chip many times; none of it may have asked the
    // desktop for anything.
    expect(mocks.reveal).not.toHaveBeenCalled()
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

  it('explains a relative path on a network workspace before offering navigation', () => {
    mocks.desktop = true
    mocks.workspaceRoot = '\\\\server\\share'
    render(<FileReference reference={reference('docs/readme.md')} />)
    expect(screen.queryByRole('button', { name: /File Explorer/ })).toBeNull()
    fireEvent.click(label('docs/readme.md'))
    expect(panel().getByText('That path is on another computer, so it cannot be shown here.')).toBeTruthy()
  })

  it.each([
    '[notes](docs/readme.md)',
    '```ts:src/app.ts\nconst a = 1\n```',
  ])('keeps every path surface passive during streaming: %s', (text) => {
    mocks.desktop = true
    const view = render(<Markdown text={text} streaming />)
    expect(view.container.querySelector('[aria-haspopup="menu"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /File Explorer/ })).toBeNull()
    view.rerender(<Markdown text={text} />)
    expect(view.container.querySelector('[aria-haspopup="menu"]')).not.toBeNull()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('keeps code inside a web link passive and opens only the web panel', () => {
    mocks.desktop = true
    const { container } = render(<Markdown text={'[`docs/readme.md`](https://example.com)'} />)
    const link = screen.getByRole('link')
    expect(link.querySelector('button')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('docs/readme.md')
    fireEvent.click(link)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it('disables the direct reveal control while navigation is pending', async () => {
    mocks.desktop = true
    let finish: (() => void) | undefined
    mocks.reveal.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<FileReference reference={reference('C:\\Proj\\app.ts')} />)
    const button = screen.getByRole('button', { name: /Show .* in File Explorer/ })
    fireEvent.click(button)
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(mocks.reveal).toHaveBeenCalledTimes(1)
    finish?.()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  })
})
