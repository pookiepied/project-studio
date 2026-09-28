import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented, TextField } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane } from '@/features/settings/panes/Pane'
import { KeepDialog } from '@/features/library/KeepDialog'
import { base64OfFile, type KeepCandidate } from '@/features/library/client'
import { useLibrary, type LibraryView } from '@/features/settings/library/useLibrary'
import { harnessBytesDataUrl, libraryBytesPath, type LibraryItem, type LibraryKind } from '@/platform/harness'

/**
 * The library.
 *
 * Everything the person chose to keep beyond one conversation: their own
 * photos, logos, documents and references, each with the words they gave
 * it. The pane is a wall of those files and very little else: one toolbar
 * row — search, kind, refresh, add — and then the grid, because a library
 * is looked at, not read. The prose that used to stand around it (what the
 * page is for, where the files live) moved out of the way entirely: the
 * sentences a person needs are the ones the keep dialog says at the moment
 * of keeping, and the directory is a fact for debugging, which is where it
 * belongs. Every card opens the same dialog the composer uses, so keeping
 * and editing are one thing. Files can also be added here directly, which
 * is how a document reaches the library today: the composer takes pictures
 * only.
 */
export function LibraryPane() {
  const library = useLibrary()
  const [adding, setAdding] = useState<KeepCandidate | null>(null)
  const [editing, setEditing] = useState<LibraryItem | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const pick = async (files: FileList | null) => {
    const file = files?.[0]
    if (file === undefined) return
    const maxBytes = library.view.status === 'ready' ? library.view.listing.maxFileBytes : 50 * 1024 * 1024
    if (file.size > maxBytes) {
      setNote(`${file.name} is larger than the library takes (${String(Math.round(maxBytes / (1024 * 1024)))} MB).`)
      return
    }
    setNote(null)
    setAdding({
      fileName: file.name,
      mimeType: file.type === '' ? 'application/octet-stream' : file.type,
      data: await base64OfFile(file),
      sourceConversationId: null,
    })
  }

  return (
    <Pane title="Library">
      <input
        ref={picker}
        type="file"
        className="hidden"
        onChange={(event) => {
          void pick(event.target.files)
          event.target.value = ''
        }}
      />
      <Toolbar
        library={library}
        subjects={library.view.status === 'ready' ? library.view.listing.subjects : []}
        onRefresh={() => void library.refresh()}
        onAdd={() => picker.current?.click()}
      />
      <Body
        view={library.view}
        onEdit={setEditing}
        onRemove={async (item) => {
          const error = await library.remove(item.id)
          setNote(error === null ? null : error.message)
        }}
      />
      {note !== null ? (
        <p role="alert" className="pb-3.5 text-caption text-danger">
          {note}
        </p>
      ) : null}

      <KeepDialog
        open={adding !== null || editing !== null}
        candidate={adding}
        editing={editing}
        onClose={() => {
          setAdding(null)
          setEditing(null)
        }}
        onKept={() => void library.refresh()}
      />
    </Pane>
  )
}

/**
 * The pane's one control row: search, kind, and the two verbs. Nothing here
 * has a label saying what it is — a magnifier over a field reads as search,
 * the words All/Images/Documents read as a filter, and the row is the first
 * thing under the title, so nothing needs a sentence introducing it.
 */
function Toolbar({
  library,
  subjects,
  onRefresh,
  onAdd,
}: {
  library: ReturnType<typeof useLibrary>
  subjects: readonly string[]
  onRefresh: () => void
  onAdd: () => void
}) {
  const { filter, setFilter, view, refreshing } = library
  return (
    <div className="flex flex-col gap-2.5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <TextField
            value={filter.query}
            onChange={(query) => setFilter({ ...filter, query })}
            placeholder="Search the library"
            ariaLabel="Search the library"
          />
        </div>
        <Segmented
          options={KIND_OPTIONS}
          value={filter.kind ?? 'all'}
          onChange={(kind) => setFilter({ ...filter, kind: kind === 'all' ? null : kind })}
          ariaLabel="Kind"
          layoutId="library-kind"
        />
        <div className="flex items-center gap-1">
          <IconButton label="Refresh" onClick={onRefresh} disabled={refreshing}>
            <Icons.reload />
          </IconButton>
          <Button variant="primary" size="sm" onClick={onAdd} disabled={view.status !== 'ready'}>
            Add a file
          </Button>
        </div>
      </div>
      {subjects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {subjects.map((subject) => {
            const on = filter.subject === subject
            return (
              <button
                key={subject}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter({ ...filter, subject: on ? null : subject })}
                className={
                  on
                    ? 'rounded-full bg-foreground px-2.5 py-0.5 text-caption text-background'
                    : 'rounded-full bg-tint px-2.5 py-0.5 text-caption text-foreground hover:bg-selected'
                }
              >
                {subject}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const KIND_OPTIONS: readonly { id: LibraryKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'other', label: 'Other' },
]

function Body({
  view,
  onEdit,
  onRemove,
}: {
  view: LibraryView
  onEdit: (item: LibraryItem) => void
  onRemove: (item: LibraryItem) => void
}) {
  if (view.status === 'loading') return <Loading label="Loading the library" />
  if (view.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="The library is kept by the harness, so it cannot be read until it starts."
      />
    )
  }
  if (view.status === 'failed') {
    return <StateNote title="The library could not be read." detail={view.error.message} />
  }
  const { items } = view.listing
  if (items.length === 0) {
    return (
      <StateNote
        title="Nothing kept yet."
        detail="Keep a picture from the composer's bookmark, or add a file here."
      />
    )
  }
  return (
    <ul className="grid grid-cols-2 gap-3 py-3.5 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.id} item={item} onEdit={onEdit} onRemove={onRemove} />
      ))}
    </ul>
  )
}

/**
 * One kept file, drawn as its picture.
 *
 * The card used to be a framed panel carrying the title, the subject or
 * file name, and the tags — three lines of words under every picture, which
 * is a database row wearing a gallery's clothes. A wall of files identifies
 * by sight; the words are what the dialog edits, and they are one click
 * away. So the card is the thumbnail and one quiet line under it, no frame
 * and no surface: the pictures make the grid, and nothing annotates them
 * until a person asks.
 */
function Card({
  item,
  onEdit,
  onRemove,
}: {
  item: LibraryItem
  onEdit: (item: LibraryItem) => void
  onRemove: (item: LibraryItem) => void
}) {
  return (
    <li className="group relative flex flex-col">
      <button
        type="button"
        onClick={() => onEdit(item)}
        className="flex min-w-0 flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Edit ${item.title}`}
      >
        <Thumbnail item={item} />
        <span className="truncate px-0.5 text-caption text-muted-foreground" title={item.title}>
          {item.title}
        </span>
      </button>
      <div className="absolute right-1.5 top-1.5 rounded-full bg-surface/85 p-0.5 opacity-0 shadow-chip backdrop-blur-sm transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label={`Remove ${item.title}`} onClick={() => onRemove(item)}>
          <Icons.delete />
        </IconButton>
      </div>
    </li>
  )
}

function Thumbnail({ item }: { item: LibraryItem }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (item.kind !== 'image') return
    let cancelled = false
    void harnessBytesDataUrl(libraryBytesPath(item.id), item.mimeType).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [item.id, item.kind, item.mimeType])

  return (
    <span className="block overflow-hidden rounded-lg">
      {item.kind === 'image' && src !== null ? (
        <img src={src} alt="" className="aspect-square w-full object-cover" draggable={false} />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center bg-tint text-muted-foreground">
          {item.kind === 'image' ? <Icons.image /> : <Icons.file />}
        </span>
      )}
    </span>
  )
}
