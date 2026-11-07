/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilePreview } from './FilePreview'
import { fileKindOf, traitsOf } from './fileKinds'
import type { LocatedFile } from './useLocatedFile'

const mocks = vi.hoisted(() => ({ readFileText: vi.fn(), bytes: vi.fn() }))

vi.mock('@/platform/tauri/window', () => ({ isTauri: () => false }))
vi.mock('@/platform/tauri/reveal', () => ({ revealPath: vi.fn() }))
vi.mock('@/platform/tauri/files', () => ({ openFile: vi.fn(), openInEditor: vi.fn(), installedEditors: () => Promise.resolve([]) }))
vi.mock('@/platform/harness', async (original) => ({
  ...await original<object>(),
  harnessBytesDataUrl: (...args: unknown[]) => mocks.bytes(...args),
}))
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({ readFileText: mocks.readFileText }),
  useOptionalWorkspace: () => null,
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const located = (path: string): LocatedFile => ({
  path, kind: fileKindOf(path, false), line: null, column: null, inConversation: true, others: 0,
})

describe('the file viewer', () => {
  it('renders Markdown as a document', async () => {
    mocks.readFileText.mockResolvedValue({ ok: true, value: { text: '# Climate\n\nBody', truncated: false } })
    render(<FilePreview file={located('C:\\w\\climate.md')} conversationId="cnv_1" />)
    expect((await screen.findByRole('heading', { name: 'Climate' })).tagName).toBe('H1')
    expect(mocks.readFileText).toHaveBeenCalledWith('cnv_1', 'C:\\w\\climate.md')
  })

  it('says when it shows only the start of a long file', async () => {
    mocks.readFileText.mockResolvedValue({ ok: true, value: { text: 'a,b', truncated: true } })
    render(<FilePreview file={located('C:\\w\\data.csv')} conversationId="cnv_1" />)
    expect(await screen.findByText('Showing the start of this file.')).toBeTruthy()
  })

  it('shows a picture through the harness, by its real path', async () => {
    mocks.bytes.mockResolvedValue('data:image/png;base64,AAAA')
    render(<FilePreview file={located('C:\\w\\chart.png')} conversationId="cnv_1" />)
    expect((await screen.findByRole('img', { name: 'chart.png' })).getAttribute('src')).toContain('data:image/png')
    expect(mocks.bytes.mock.calls[0]?.[0]).toBe(`/api/media/workspace/cnv_1?path=${encodeURIComponent('C:\\w\\chart.png')}`)
    expect(mocks.readFileText).not.toHaveBeenCalled()
  })

  it.each([
    ['the harness declines', { ok: true, value: null }],
    ['the harness is down', { ok: false, error: { kind: 'not-reachable', message: 'down' } }],
  ])('says so plainly when %s', async (_, answer) => {
    mocks.readFileText.mockResolvedValue(answer)
    render(<FilePreview file={located('C:\\w\\notes.md')} conversationId="cnv_1" />)
    expect(await screen.findByText('This file cannot be shown here.')).toBeTruthy()
  })
})

describe('file kinds', () => {
  it.each([
    ['a.md', 'markdown'], ['a.TXT', 'text'], ['a.html', 'page'], ['a.ts', 'code'], ['Dockerfile', 'code'],
    ['a.png', 'picture'], ['a.mp4', 'media'], ['a.pdf', 'document'], ['a.exe', 'program'], ['a.zip', 'program'],
    ['.env', 'secret'], ['.env.local', 'secret'], ['a.pem', 'secret'], ['a.unknownthing', 'other'],
  ])('reads %s as %s', (path, kind) => {
    expect(fileKindOf(path, false)).toBe(kind)
  })

  it('lets a folder win over whatever its name looks like', () => {
    expect(fileKindOf('release.md', true)).toBe('folder')
  })

  it('previews only the pictures the harness will serve', () => {
    expect(traitsOf('picture', 'a.png').preview).toBe('picture')
    expect(traitsOf('picture', 'a.heic').preview).toBeNull()
  })

  it('never hands source code to its Windows association', () => {
    for (const path of ['a.js', 'a.py', 'a.ps1', 'a.sh', 'a.bat']) {
      expect(traitsOf(fileKindOf(path, false), path).opens).toBe(false)
    }
  })
})
