/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { LocatedFile } from '@/features/files/useLocatedFile'
import { ViewerProvider, useViewer } from './ViewerProvider'

afterEach(cleanup)
const file: LocatedFile = { path: 'C:\\work\\notes.md', kind: 'markdown', line: null, column: null, inConversation: true, others: 0 }

describe('the document desk', () => {
  it('reuses a file tab and restores its document after visiting the browser', () => {
    const { result } = renderHook(useViewer, { wrapper: ({ children }: { children: ReactNode }) => <ViewerProvider conversationId="a">{children}</ViewerProvider> })
    act(() => { result.current?.openFile(file); result.current?.openFile({ ...file, line: 42 }) })
    expect(result.current?.tabs).toHaveLength(1)
    expect(result.current?.open).toBe(true)
    expect(result.current?.active).toEqual({ key: `file:${file.path}`, kind: 'file', file: { ...file, line: 42 } })
    act(() => result.current?.openBrowser())
    expect(result.current?.active?.kind).toBe('browser')
    act(() => result.current?.closeTab('browser'))
    expect(result.current?.active).toEqual({ key: `file:${file.path}`, kind: 'file', file: { ...file, line: 42 } })
    act(() => result.current?.close())
    expect(result.current?.open).toBe(false)
    act(() => result.current?.toggle())
    expect(result.current?.tabs).toHaveLength(1)
  })

  it('keeps documents in their own conversation, including a late old callback', () => {
    let scope = 'a'
    const { result, rerender } = renderHook(useViewer, { wrapper: ({ children }: { children: ReactNode }) => <ViewerProvider conversationId={scope}>{children}</ViewerProvider> })
    const openInA = result.current?.openFile
    act(() => result.current?.openFile(file))
    scope = 'b'
    rerender()
    expect(result.current?.tabs).toHaveLength(0)
    act(() => openInA?.({ ...file, path: 'C:\\work\\later.md' }))
    expect(result.current?.tabs).toHaveLength(0)
    act(() => result.current?.openBrowser())
    scope = 'a'
    rerender()
    expect(result.current?.tabs.map(tab => tab.kind)).toEqual(['file', 'file'])
    expect(result.current?.tabs.some(tab => tab.kind === 'browser')).toBe(false)
  })

  it('opens an empty desk on Home without inventing file or browser ownership', () => {
    const { result } = renderHook(useViewer, { wrapper: ({ children }: { children: ReactNode }) => <ViewerProvider conversationId={null}>{children}</ViewerProvider> })
    act(() => { result.current?.toggle(); result.current?.openFile(file); result.current?.openBrowser() })
    expect(result.current?.open).toBe(true)
    expect(result.current?.tabs).toHaveLength(0)
    expect(result.current?.active).toBeNull()
  })
})
