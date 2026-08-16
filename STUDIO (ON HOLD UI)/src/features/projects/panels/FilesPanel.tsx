import { useState, type DragEvent } from 'react'
import { Attach, Close, File, Link, Microphone } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project, ProjectFile } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/** Demo rows for the "Add file" button — the real picker lands with Tauri. */
const DEMO_FILES = [
  { name: 'field-recording.wav', meta: '18.2 MB' },
  { name: 'moodboard.zip', meta: '42 MB' },
  { name: 'contract.pdf', meta: '310 KB' },
  { name: 'sketch.fig', meta: '5.7 MB' },
] as const

const KIND_ICON = { file: File, link: Link, transcription: Microphone } as const

/**
 * Everything dropped into the project: files, saved links, and voice
 * transcriptions. The drop zone is real about names — whatever you drop lands
 * as a row — and honest about the rest: it stores rows in demo state, not
 * bytes on disk.
 */
export function FilesPanel({ project }: { project: Project }) {
  const { addFile, removeFile } = useProjects()
  const [dragging, setDragging] = useState(false)
  const [addingLink, setAddingLink] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [demoIndex, setDemoIndex] = useState(0)

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    for (const file of Array.from(event.dataTransfer.files)) {
      addFile(project.id, { kind: 'file', name: file.name, meta: formatSize(file.size) })
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(true)
  }

  const addDemoFile = () => {
    const demo = DEMO_FILES[demoIndex % DEMO_FILES.length]
    setDemoIndex((index) => index + 1)
    addFile(project.id, { kind: 'file', name: demo.name, meta: demo.meta })
  }

  const addLink = () => {
    const raw = linkDraft.trim()
    if (!raw) return
    let meta = raw
    try {
      meta = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname
    } catch {
      /* keep the raw text as the meta */
    }
    addFile(project.id, { kind: 'link', name: raw, meta })
    setLinkDraft('')
    setAddingLink(false)
  }

  return (
    <div
      className="h-full overflow-y-auto"
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="mx-auto w-full max-w-xl px-6 py-7">
        <div
          className={cn(
            'flex flex-col items-center rounded-xl border border-dashed px-6 py-7 text-center transition-colors',
            dragging ? 'border-ring bg-muted/50' : 'border-border',
          )}
        >
          <Attach size="md" className="text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">
            Drop files to attach them to this project
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addDemoFile}>
              Add file
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingLink((open) => !open)}
              aria-expanded={addingLink}
            >
              Add link
            </Button>
          </div>

          {addingLink && (
            <div className="mt-3 flex w-full items-center gap-1.5">
              <input
                autoFocus
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addLink()
                  if (event.key === 'Escape') setAddingLink(false)
                }}
                placeholder="https://…"
                aria-label="Link URL"
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-ring/60"
              />
              <Button size="sm" onClick={addLink} disabled={!linkDraft.trim()}>
                Save
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col">
          {project.files.map((file) => (
            <FileRow key={file.id} file={file} onRemove={() => removeFile(project.id, file.id)} />
          ))}
          {project.files.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nothing attached yet. Files, links and transcriptions land here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function FileRow({ file, onRemove }: { file: ProjectFile; onRemove: () => void }) {
  const KindIcon = KIND_ICON[file.kind]
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      <KindIcon size="sm" className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{file.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{file.meta}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        <Close size="xs" />
      </button>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}
