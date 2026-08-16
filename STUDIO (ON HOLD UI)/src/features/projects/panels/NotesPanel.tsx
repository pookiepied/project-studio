import { useState } from 'react'
import { Close, Note, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/**
 * Notes, the Notion way: a quiet list on the left, the page on the right.
 * The page is two bare fields — a display-serif title and an editorial body —
 * because a note that looks like a form never gets written in. Every
 * keystroke saves; there is no save button to forget.
 */
export function NotesPanel({ project }: { project: Project }) {
  const { addNote, updateNote, removeNote } = useProjects()
  const [selectedId, setSelectedId] = useState<string | null>(project.notes[0]?.id ?? null)

  const selected = project.notes.find((note) => note.id === selectedId) ?? null

  const newNote = () => {
    const note = addNote(project.id)
    setSelectedId(note.id)
  }

  const remove = (noteId: string) => {
    removeNote(project.id, noteId)
    if (selectedId === noteId) {
      setSelectedId(project.notes.find((note) => note.id !== noteId)?.id ?? null)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border/60">
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <span className="px-1 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            Notes
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New note"
            onClick={newNote}
            className="rounded-md text-muted-foreground"
          >
            <Plus size="sm" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {project.notes.map((note) => (
            <div key={note.id} className="group relative">
              <button
                type="button"
                onClick={() => setSelectedId(note.id)}
                aria-current={note.id === selectedId ? 'page' : undefined}
                className={cn(
                  'w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                  note.id === selectedId ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="block truncate pr-4 text-[13px] font-medium">
                  {note.title || 'Untitled'}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {note.updatedAt}
                  {note.body ? `  ·  ${note.body}` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(note.id)}
                aria-label={`Delete ${note.title || 'untitled note'}`}
                className="absolute top-2 right-1.5 rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
              >
                <Close size="xs" />
              </button>
            </div>
          ))}
          {project.notes.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No notes yet.</p>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="mx-auto w-full max-w-2xl px-8 py-7">
            <input
              value={selected.title}
              onChange={(event) =>
                updateNote(project.id, selected.id, { title: event.target.value })
              }
              placeholder="Untitled"
              aria-label="Note title"
              className="w-full bg-transparent studio-display text-[28px] outline-none placeholder:text-muted-foreground/40"
            />
            <textarea
              value={selected.body}
              onChange={(event) =>
                updateNote(project.id, selected.id, { body: event.target.value })
              }
              placeholder="Start writing…"
              aria-label="Note body"
              className="mt-3 min-h-[45vh] w-full resize-none bg-transparent font-sans text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Note size="lg" className="text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">Select a note, or start a new one.</p>
          </div>
        )}
      </div>
    </div>
  )
}
