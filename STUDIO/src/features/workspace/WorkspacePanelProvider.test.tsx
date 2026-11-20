/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { LocatedFile } from '@/features/files/useLocatedFile'
import { WorkspacePanelProvider, useWorkspacePanel } from './WorkspacePanelProvider'

afterEach(cleanup)
const file: LocatedFile = { path: 'C:\\work\\notes.md', kind: 'markdown', line: null, column: null, inConversation: true, others: 0 }

describe('the document desk', () => {
  it('reveals the first agent browser and respects both workspace and browser-tab dismissal', () => {
    const { result } = renderHook(useWorkspacePanel, { wrapper: ({ children }: { children: ReactNode }) => <WorkspacePanelProvider conversationId="a">{children}</WorkspacePanelProvider> })
    act(() => result.current?.revealAgentBrowser())
    expect(result.current?.open).toBe(true)
    expect(result.current?.active?.kind).toBe('browser')
    act(() => { result.current?.toggle(); result.current?.revealAgentBrowser() })
    expect(result.current?.open).toBe(false)
    act(() => result.current?.toggle())
    expect(result.current?.tabs).toHaveLength(1)
    act(() => { result.current?.closeTab('browser'); result.current?.revealAgentBrowser() })
    expect(result.current?.tabs).toHaveLength(0)
    act(() => { result.current?.openBrowser(); result.current?.openFile(file); result.current?.revealAgentBrowser() })
    expect(result.current?.active?.kind).toBe('file')
  })

  it('keeps a hidden workspace closed even when a different chat first uses the browser', () => {
    let scope = 'a'
    const { result, rerender } = renderHook(useWorkspacePanel, { wrapper: ({ children }: { children: ReactNode }) => <WorkspacePanelProvider conversationId={scope}>{children}</WorkspacePanelProvider> })
    act(() => result.current?.close())
    scope = 'b'
    rerender()
    act(() => result.current?.revealAgentBrowser())
    expect(result.current?.open).toBe(false)
    act(() => result.current?.toggle())
    expect(result.current?.active?.kind).toBe('browser')
  })
  it('moves workspace tabs without changing the selected document', () => {
    const { result } = renderHook(useWorkspacePanel, { wrapper: ({ children }: { children: ReactNode }) => <WorkspacePanelProvider conversationId="a">{children}</WorkspacePanelProvider> })
    act(() => { result.current?.openBrowser(); result.current?.openFile(file); result.current?.addTab() })
    const fileKey = `file:${file.path}`
    act(() => { result.current?.select(fileKey); result.current?.moveTab('browser', fileKey) })
    expect(result.current?.tabs.map(tab => tab.kind)).toEqual(['file', 'browser', 'new'])
    expect(result.current?.active?.key).toBe(fileKey)
  })
  it('reuses a file tab and restores its document after visiting the browser', () => {
    const { result } = renderHook(useWorkspacePanel, { wrapper: ({ children }: { children: ReactNode }) => <WorkspacePanelProvider conversationId="a">{children}</WorkspacePanelProvider> })
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
    const { result, rerender } = renderHook(useWorkspacePanel, { wrapper: ({ children }: { children: ReactNode }) => <WorkspacePanelProvider conversationId={scope}>{children}</WorkspacePanelProvider> })
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
    const { result } = renderHook(useWorkspacePanel, { wrapper: ({ children }: { children: ReactNode }) => <WorkspacePanelProvider conversationId={null}>{children}</WorkspacePanelProvider> })
    act(() => { result.current?.toggle(); result.current?.openFile(file); result.current?.openBrowser() })
    expect(result.current?.open).toBe(true)
    expect(result.current?.tabs).toHaveLength(0)
    expect(result.current?.active).toBeNull()
  })
})
