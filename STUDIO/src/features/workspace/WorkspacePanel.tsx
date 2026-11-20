import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { Icons } from '@/components/icons'
import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { Button, IconButton, MenuItem, Popover } from '@/components/primitives'
import { PANEL_VIEW_TRANSITION } from '@/design/tokens'
import { BrowserWindow } from '@/features/browser/BrowserWindow'
import { SiteMark } from '@/features/artifacts/kinds/SiteMark'
import { writeQuote } from '@/features/chat/composer/drafts'
import { FileContent } from '@/features/files/FilePreview'
import { FileMenu } from '@/features/files/FileMenu'
import { fileKindOf, traitsOf } from '@/features/files/fileKinds'
import type { LocatedFile } from '@/features/files/useLocatedFile'
import { useOverview } from '@/stores/overview'
import { useWorkspace } from '@/stores/workspace'
import { useWorkspacePanel } from './WorkspacePanelProvider'

/** The central work area for documents and the live browser. Overview owns activity. */
export function WorkspacePanel({ visible = true }: { visible?: boolean }) {
  const workspacePanel = useWorkspacePanel()
  const { locateFile } = useWorkspace()
  const { activity } = useOverview()
  const [path, setPath] = useState('')
  const [fileActions, setFileActions] = useState<HTMLDivElement | null>(null)
  const [browserPage, setBrowserPage] = useState<{ conversationId: string; title: string; url: string } | null>(null)
  const dragTab = useRef<string | null>(null)
  const [dropTab, setDropTab] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const tabsId = useId()
  const tabStrip = useRef<HTMLDivElement>(null)
  const addFile = useRef<HTMLButtonElement>(null)
  const restoreTabFocus = useRef(false)
  const conversationId = workspacePanel?.conversationId ?? null
  const selected = workspacePanel?.selected ?? null
  useEffect(() => {
    request.current += 1
    setBusy(false)
    setError(null)
    setPath('')
    return () => { request.current += 1 }
  }, [conversationId, selected])
  useEffect(() => {
    const tab = tabStrip.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    if (restoreTabFocus.current) (tab ?? addFile.current)?.focus()
    restoreTabFocus.current = false
  }, [selected])

  if (workspacePanel === null) return null
  const recent: string[] = []
  const seen = new Set<string>()
  for (const turn of [...activity.turns].reverse()) {
    for (const change of turn.changes) {
      if (seen.has(change.path)) continue
      seen.add(change.path)
      if (change.action !== 'Deleted') recent.push(change.path)
    }
  }
  const openPath = async (written: string) => {
    if (conversationId === null || written.trim() === '') return
    const current = ++request.current
    setBusy(true)
    setError(null)
    try {
      const result = await locateFile(conversationId, written.trim())
      if (current !== request.current) return
      if (!result.ok) { setError('Studio could not look for this file. Try again.'); return }
      if (result.value === null) { setError('File not found in this conversation\'s folders.'); return }
      const found = result.value
      restoreTabFocus.current = true
      workspacePanel.openFile({ path: found.path, kind: fileKindOf(found.path, found.kind === 'folder'),
        inConversation: true, line: null, column: null, others: found.others }, selected ?? undefined)
      setPath('')
    } catch {
      if (current === request.current) setError('Studio could not look for this file. Try again.')
    } finally {
      if (current === request.current) setBusy(false)
    }
  }
  const chooser = (
    <div className="studio-scroll-inset flex h-full flex-col overflow-y-auto px-5 py-8">
      {conversationId === null
        ? <p className="m-auto text-center text-caption text-muted-foreground">Open a conversation to use its workspace.</p>
        : <div className="mx-auto my-auto flex w-full max-w-96 flex-col gap-3">
          <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void openPath(path) }}>
            <input aria-label="File path" value={path} onChange={event => setPath(event.target.value)}
              placeholder="Open a file by name or path" autoComplete="off" spellCheck={false}
              className="studio-selectable min-w-0 flex-1 rounded-md border bg-tint px-3 py-2 text-caption" />
            <Button type="submit" size="sm" disabled={busy || path.trim() === ''}>{busy ? 'Opening' : 'Open'}</Button>
          </form>
          {error !== null ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
          <div className="self-start">
            <Button size="sm" variant="ghost" icon={<Icons.browserUse size="sm" />} onClick={() => {
              restoreTabFocus.current = true
              workspacePanel.openBrowser(selected ?? undefined)
            }}>Open Studio Browser</Button>
          </div>
          {recent.length > 0 ? <div className="flex flex-col gap-1">
            <h3 className="px-2 text-micro text-muted-foreground">Recent files</h3>
            {recent.map(file => <button key={file} type="button" disabled={busy} onClick={() => void openPath(file)}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-caption hover:bg-tint">
              <FileTypeMark path={file} /><span className="truncate">{splitFilePath(file).name}</span>
            </button>)}
          </div> : null}
        </div>}
    </div>
  )

  return (
    <section aria-label="Workspace" className="studio-workspace flex min-h-0 min-w-0 flex-col bg-surface text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      {workspacePanel.tabs.length > 0 ? (
        <div ref={tabStrip} role="tablist" aria-label="Open work" className="studio-workspace-tabs flex min-w-0 flex-1 gap-1 overflow-x-auto p-0.5"
          onKeyDown={event => {
            if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
            if (event.key === 'Delete' && selected !== null) {
              event.preventDefault()
              restoreTabFocus.current = true
              workspacePanel.closeTab(selected)
              return
            }
            const index = workspacePanel.tabs.findIndex(tab => tab.key === workspacePanel.selected)
            if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
              const target = workspacePanel.tabs[index + (event.key === 'ArrowLeft' ? -1 : 1)]
              if (selected !== null && target) {
                event.preventDefault()
                workspacePanel.moveTab(selected, target.key)
              }
              return
            }
            const next = event.key === 'ArrowRight' ? (index + 1) % workspacePanel.tabs.length
              : event.key === 'ArrowLeft' ? (index + workspacePanel.tabs.length - 1) % workspacePanel.tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? workspacePanel.tabs.length - 1 : null
            const tab = next === null ? undefined : workspacePanel.tabs[next]
            if (tab === undefined || next === null) return
            event.preventDefault()
            workspacePanel.select(tab.key)
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          }}>
          {workspacePanel.tabs.map((tab, index) => {
            const title = tab.kind === 'file' ? splitFilePath(tab.file.path).name
              : tab.kind === 'browser' ? (browserPage?.conversationId === conversationId ? browserPage?.title : null) || 'Browser' : 'New tab'
            return (
              <div key={tab.key} role="presentation" draggable={workspacePanel.tabs.length > 1}
                className="studio-workspace-tab flex w-36 flex-none items-center gap-1 rounded-md pr-1"
                data-selected={workspacePanel.selected === tab.key} data-drop={dropTab === tab.key}
                onDragStart={event => {
                  dragTab.current = tab.key
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('application/x-studio-workspace-tab', tab.key)
                }}
                onDragOver={event => {
                  if (dragTab.current === null || dragTab.current === tab.key) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTab(tab.key)
                }}
                onDragLeave={event => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTab(null)
                }}
                onDrop={event => {
                  if (dragTab.current === null) return
                  event.preventDefault()
                  workspacePanel.moveTab(dragTab.current, tab.key)
                  dragTab.current = null
                  setDropTab(null)
                }}
                onDragEnd={() => { dragTab.current = null; setDropTab(null) }}>
                <button type="button" role="tab" id={`${tabsId}-tab-${index}`} aria-selected={workspacePanel.selected === tab.key} aria-controls={`${tabsId}-panel-${index}`}
                  tabIndex={workspacePanel.selected === tab.key ? 0 : -1} onClick={() => workspacePanel.select(tab.key)}
                  className="flex min-h-[var(--button-sm)] min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 pr-1 text-caption focus-visible:outline-offset-[-2px]">
                  {tab.kind === 'file' ? <FileTypeMark path={tab.file.path} /> : tab.kind === 'browser'
                    ? <SiteMark href={browserPage?.conversationId === conversationId ? browserPage?.url ?? '' : ''} compact /> : null}
                  <span className="truncate">{title}</span>
                </button>
                <IconButton label={tab.kind === 'browser' ? 'Close Browser' : `Close ${title}`} size="xs" onClick={() => {
                  if (tab.key === selected) restoreTabFocus.current = true
                  else tabStrip.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
                  workspacePanel.closeTab(tab.key)
                }}><Icons.close size="sm" /></IconButton>
              </div>
            )
          })}
        </div>
      ) : <h2 className="min-w-0 flex-1 px-1 text-caption font-medium">Workspace</h2>}
        <div ref={setFileActions} className="contents" />
        <IconButton ref={addFile} label="New workspace tab" tooltipSide="bottom" size="sm" onClick={() => {
          restoreTabFocus.current = true
          workspacePanel.addTab()
        }} disabled={conversationId === null}><Icons.add size="sm" /></IconButton>
        <IconButton label="Hide Workspace" tooltipSide="bottom" size="header" onClick={workspacePanel.close}><Icons.workArea size="header" /></IconButton>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
        {conversationId !== null ? workspacePanel.tabs.map((tab, index) => {
          const active = selected === tab.key
          return <WorkspaceView key={`${conversationId}:${tab.key}`} id={`${tabsId}-panel-${index}`}
            labelledBy={`${tabsId}-tab-${index}`} active={active}>
            {shown => tab.kind === 'file' ? <Document file={tab.file} conversationId={conversationId} active={shown && visible} fileActions={fileActions} />
              : tab.kind === 'browser' ? <BrowserWindow conversationId={conversationId} embedded active={shown && visible} onPageTitle={setBrowserPage} />
                : active ? chooser : null}
          </WorkspaceView>
        }) : null}
        </AnimatePresence>
        {workspacePanel.active === null ? chooser : null}
      </div>
    </section>
  )
}

function WorkspaceView({ id, labelledBy, active, children }: {
  id: string; labelledBy: string; active: boolean; children: (shown: boolean) => ReactNode
}) {
  const present = useIsPresent()
  const shown = active && present
  return <motion.div role="tabpanel" id={present ? id : undefined} aria-labelledby={present ? labelledBy : undefined} aria-hidden={!shown} inert={!shown}
    initial={{ opacity: 0, x: 8 }}
    animate={active ? { opacity: 1, x: 0, visibility: 'visible' }
      : { opacity: 0, x: -8, transitionEnd: { visibility: 'hidden' } }}
    exit={{ opacity: 0, x: -8 }}
    transition={PANEL_VIEW_TRANSITION} className="absolute inset-0">
    {children(shown)}
  </motion.div>
}

function Document({ file, conversationId, active, fileActions }: {
  file: LocatedFile; conversationId: string; active: boolean; fileActions: HTMLDivElement | null
}) {
  const [source, setSource] = useState(false)
  const [revision, setRevision] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [quoteNotice, setQuoteNotice] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const passage = useRef('')
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const preview = traitsOf(file.kind, file.path).preview
  const sourceView = preview === 'text' || source
  useEffect(() => { if (!active) setMenuOpen(false) }, [active])
  const closeMenu = () => {
    setMenuOpen(false)
    menuTrigger.current?.focus()
  }
  const captureSelection = () => {
    const selection = window.getSelection()
    passage.current = selection?.anchorNode && body.current?.contains(selection.anchorNode)
      && body.current.contains(selection.focusNode) ? selection.toString().trim() : ''
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col">
        {active && fileActions !== null ? createPortal(<Popover open={menuOpen} onOpenChange={setMenuOpen} align="end" initialFocus="[role='menuitem']" className="w-60" trigger={
          <span onMouseDown={event => event.preventDefault()}>
            <IconButton ref={menuTrigger} label="File actions" tooltipSide="bottom" size="sm" hasPopup="menu" expanded={menuOpen}
              onClick={() => {
                if (!menuOpen) { captureSelection(); setQuoteNotice('') }
                setMenuOpen(!menuOpen)
              }}><Icons.more size="sm" /></IconButton>
          </span>
        }>
          <FileMenu lookup={{ state: 'found', file }} written={file.path} onPreview={null} onDone={closeMenu} actions={<>
            <MenuItem icon={<Icons.quote />} onSelect={() => {
              writeQuote(conversationId, passage.current === '' ? `File: ${file.path}` : `${file.path}\n\n${passage.current}`)
              setQuoteNotice('Added to reply')
              closeMenu()
            }}>Discuss file or selected text</MenuItem>
            {preview !== null ? <MenuItem icon={<Icons.reload />} onSelect={() => {
              setRevision(value => value + 1)
              closeMenu()
            }}>Refresh file</MenuItem> : null}
          </>} />
        </Popover>, fileActions) : null}
      <div ref={body} className="studio-workspace-document studio-scroll-inset min-h-0 flex-1 overflow-auto"
        data-source={sourceView} data-floating-view={preview === 'markdown'}>
        {preview !== null ? <FileContent file={file} conversationId={conversationId} source={source} revision={revision} standalone />
          : <p className="py-8 text-caption text-muted-foreground">A preview is unavailable for this file. See File actions.</p>}
      </div>
      {preview === 'markdown' ? <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <IconButton label={source ? 'Show rendered document' : 'Show source'} size="md" className="pointer-events-auto border bg-surface-raised shadow-overlay hover:bg-muted"
          onClick={() => { body.current?.scrollTo?.(0, 0); setSource(value => !value) }}>
          {source ? <Icons.vision /> : <Icons.coding />}
        </IconButton>
      </div> : null}
      <div role="status" className="pointer-events-none absolute bottom-4 right-4 text-micro text-muted-foreground">
        {quoteNotice}
      </div>
    </div>
  )
}
