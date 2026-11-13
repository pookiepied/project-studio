import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/icons'
import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { Button, IconButton, Segmented } from '@/components/primitives'
import { BrowserWindow } from '@/features/browser/BrowserWindow'
import { writeQuote } from '@/features/chat/composer/drafts'
import { FilePreview } from '@/features/files/FilePreview'
import { fileKindOf, traitsOf } from '@/features/files/fileKinds'
import type { LocatedFile } from '@/features/files/useLocatedFile'
import { useFileVerbs } from '@/features/files/useFileVerbs'
import { FILE_VERB_ICONS } from '@/features/files/FileMenu'
import { useRail } from '@/stores/rail'
import { useWorkspace } from '@/stores/workspace'
import { useViewer } from './ViewerProvider'

/** A document desk beside chat; the activity workspace keeps its own job. */
export function FileViewer() {
  const viewer = useViewer()
  const { locateFile } = useWorkspace()
  const { activity } = useRail()
  const [path, setPath] = useState('')
  const [opening, setOpening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const pathField = useRef<HTMLInputElement>(null)
  const conversationId = viewer?.conversationId ?? null
  useEffect(() => {
    request.current += 1
    setBusy(false)
    setError(null)
    setPath('')
    setOpening(false)
    return () => { request.current += 1 }
  }, [conversationId])
  useEffect(() => { if (opening) pathField.current?.focus() }, [opening])

  if (viewer === null) return null
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
      viewer.openFile({ path: found.path, kind: fileKindOf(found.path, found.kind === 'folder'),
        inConversation: true, line: null, column: null, others: found.others })
      setPath('')
      setOpening(false)
    } catch {
      if (current === request.current) setError('Studio could not look for this file. Try again.')
    } finally {
      if (current === request.current) setBusy(false)
    }
  }

  return (
    <section aria-label="File Viewer" className="studio-reader flex min-h-0 min-w-0 flex-col bg-surface text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 px-4">
        <Icons.file size="sm" />
        <h2 className="min-w-0 flex-1 text-caption font-medium">File Viewer</h2>
        <IconButton label="Open another file" size="sm" onClick={() => setOpening(value => !value)} disabled={conversationId === null}>
          <Icons.add size="sm" />
        </IconButton>
        <IconButton label="Open Studio Browser in viewer" size="sm" onClick={viewer.openBrowser} disabled={conversationId === null}>
          <Icons.browserUse size="sm" />
        </IconButton>
        <IconButton label="Close File Viewer" size="sm" onClick={viewer.close}><Icons.close size="sm" /></IconButton>
      </header>
      {viewer.tabs.length > 0 ? (
        <div role="tablist" aria-label="Open documents" className="studio-reader-tabs flex shrink-0 gap-1 overflow-x-auto px-3 pb-2"
          onKeyDown={event => {
            if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
            const index = viewer.tabs.findIndex(tab => tab.key === viewer.selected)
            const next = event.key === 'ArrowRight' ? (index + 1) % viewer.tabs.length
              : event.key === 'ArrowLeft' ? (index + viewer.tabs.length - 1) % viewer.tabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? viewer.tabs.length - 1 : null
            const tab = next === null ? undefined : viewer.tabs[next]
            if (tab === undefined || next === null) return
            event.preventDefault()
            viewer.select(tab.key)
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          }}>
          {viewer.tabs.map(tab => {
            const title = tab.kind === 'browser' ? 'Browser' : splitFilePath(tab.file.path).name
            return (
              <div key={tab.key} className="studio-reader-tab flex max-w-60 shrink-0 items-center gap-1 rounded-full pr-1" data-selected={viewer.selected === tab.key}>
                <button type="button" role="tab" aria-selected={viewer.selected === tab.key} aria-controls="studio-reader-content"
                  tabIndex={viewer.selected === tab.key ? 0 : -1} onClick={() => viewer.select(tab.key)}
                  className="flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-3 pr-1 text-caption">
                  {tab.kind === 'browser' ? <Icons.browserUse size="sm" /> : <FileTypeMark path={tab.file.path} />}
                  <span className="truncate">{title}</span>
                </button>
                <IconButton label={`Close ${title}`} size="xs" onClick={() => viewer.closeTab(tab.key)}><Icons.close size="sm" /></IconButton>
              </div>
            )
          })}
        </div>
      ) : null}
      {viewer.active === null || opening ? <form className="flex shrink-0 items-center gap-2 px-4 pb-3" onSubmit={event => { event.preventDefault(); void openPath(path) }}>
        <input ref={pathField} aria-label="File path" value={path} onChange={event => setPath(event.target.value)} disabled={conversationId === null}
          placeholder="Open a file by name or path" autoComplete="off" spellCheck={false}
          className="studio-selectable min-w-0 flex-1 rounded-full bg-tint px-3 py-2 text-caption outline-none focus:ring-1 focus:ring-border" />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || conversationId === null || path.trim() === ''}>{busy ? 'Opening' : 'Open'}</Button>
      </form> : null}
      {error !== null ? <p role="alert" className="px-4 pb-3 text-caption text-danger">{error}</p> : null}
      <div id="studio-reader-content" role={viewer.active === null ? undefined : 'tabpanel'} aria-label={viewer.active?.kind === 'browser' ? 'Browser' : 'Document'}
        className="relative min-h-0 flex-1 overflow-hidden">
        {viewer.active?.kind === 'browser' && conversationId !== null ? <BrowserWindow key={conversationId} conversationId={conversationId} embedded />
          : viewer.active?.kind === 'file' && conversationId !== null
            ? <Document key={`${conversationId}:${viewer.active.key}`} file={viewer.active.file} conversationId={conversationId} />
            : <div className="studio-scroll-inset flex h-full flex-col overflow-y-auto px-5 py-8">
              <div className="my-auto flex flex-col items-center gap-3 pb-8 text-center">
                <span className="rounded-2xl bg-tint p-4"><Icons.file size="lg" /></span>
                <h3 className="text-title font-medium">A place for your work</h3>
                <p className="max-w-72 text-caption text-muted-foreground">{conversationId === null
                  ? 'Open a conversation to read its files and use its browser here.'
                  : 'Preview a file from your conversation, or enter its name above. Chat stays beside your document.'}</p>
              </div>
              {conversationId !== null && recent.length > 0 ? <div className="flex flex-col gap-1">
                <h3 className="px-3 pb-2 text-micro text-muted-foreground">Recent files</h3>
                {recent.map(file => <button key={file} type="button" disabled={busy} onClick={() => void openPath(file)}
                  className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-caption hover:bg-tint">
                  <FileTypeMark path={file} /><span className="truncate">{splitFilePath(file).name}</span>
                </button>)}
              </div> : null}
            </div>}
      </div>
    </section>
  )
}

function Document({ file, conversationId }: { file: LocatedFile; conversationId: string }) {
  const [mode, setMode] = useState('read')
  const [revision, setRevision] = useState(0)
  const [quoted, setQuoted] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const traits = traitsOf(file.kind, file.path)
  const { verbs, run, error } = useFileVerbs(file, null)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-y border-border/50 px-4 py-2">
        {file.kind === 'markdown' ? <Segmented ariaLabel="Document presentation" layoutId="reader-document-presentation" value={mode} onChange={setMode}
          options={[{ id: 'read', label: 'Read' }, { id: 'source', label: 'Source' }]} />
          : <span className="truncate text-caption text-muted-foreground">{splitFilePath(file.path).name}</span>}
        <div className="ml-auto flex items-center gap-1">
          <span onMouseDown={event => event.preventDefault()}>
          <IconButton label={quoted ? 'Added to reply' : 'Discuss file or selected text'} size="sm"
            onClick={() => {
              const selection = window.getSelection()
              const passage = selection?.anchorNode && body.current?.contains(selection.anchorNode) ? selection.toString().trim() : ''
              writeQuote(conversationId, passage === '' ? `File: ${file.path}` : `${file.path}\n\n${passage}`)
              setQuoted(true)
            }}><Icons.quote size="sm" /></IconButton>
          </span>
          {traits.preview !== null ? <IconButton label="Refresh file" size="sm" onClick={() => setRevision(value => value + 1)}><Icons.reload size="sm" /></IconButton> : null}
        </div>
      </div>
      <div ref={body} className="studio-reader-document studio-scroll-inset min-h-0 flex-1 overflow-y-auto">
        {traits.preview !== null ? <FilePreview file={file} conversationId={conversationId} source={mode === 'source'} revision={revision} />
          : <div className="flex flex-col gap-3 py-8">
            <h3 className="text-title font-medium">{splitFilePath(file.path).name}</h3>
            <p className="text-caption text-muted-foreground">This file opens in its own application.</p>
            {verbs.map(verb => { const Mark = FILE_VERB_ICONS[verb.icon]; return <Button key={verb.id} variant="secondary" size="sm" onClick={() => { void run(verb) }}><Mark size="sm" />{verb.label}</Button> })}
            {error !== null ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
          </div>}
      </div>
    </div>
  )
}
