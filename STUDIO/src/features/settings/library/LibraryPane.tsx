import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented, TextField } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane } from '@/features/settings/panes/Pane'
import { KeepDialog } from '@/features/library/KeepDialog'
import { base64OfFile, type KeepCandidate } from '@/features/library/client'
import { useLibrary, type LibraryFilter, type LibraryView } from '@/features/settings/library/useLibrary'
import { harnessBytesDataUrl, libraryBytesPath, type LibraryItem, type LibraryKind } from '@/platform/harness'

/**
 * The library.
 *
 * Everything the person chose to keep beyond one conversation: their own
 * photos, logos, documents and references, each with the words they gave
 * it. It is one grid, searched by those words and narrowed by kind or by
 * subject, and every card opens the same dialog the composer uses, so
 * keeping and editing are one thing. Files can also be added here
 * directly, which is how a document reaches the library today: the
 * composer takes pictures only.
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
    <Pane
      title="Library"
      description="Files you keep for every conversation: your photos, logos, documents. Say who or what each one is, and the model can find it when you ask."
    >
      <input
        ref={picker}
        type="file"
        className="hidden"
        onChange={(event) => {
          void pick(event.target.files)
          event.target.value = ''
        }}
      />
      <Header
        busy={library.refreshing}
        status={library.view.status}
        onRefresh={() => void library.refresh()}
        onAdd={() => picker.current?.click()}
      />
      <Filters
        filter={library.filter}
        subjects={library.view.status === 'ready' ? library.view.listing.subjects : []}
        onChange={library.setFilter}
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
        <p role="alert" className="mt-3 text-caption text-danger">
          {note}
        </p>
      ) : null}
      <WhereItLives directory={library.view.status === 'ready' ? library.view.listing.directory : null} />

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

function Header({
  busy,
  status,
  onRefresh,
  onAdd,
}: {
  busy: boolean
  status: LibraryView['status']
  onRefresh: () => void
  onAdd: () => void
}) {
  const label =
    status === 'ready' ? 'Found by every conversation' : status === 'loading' ? 'Reading the library' : ''
  return (
    <div className="flex items-center justify-between py-3.5">
      <p className="text-ui text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <IconButton label="Refresh" onClick={onRefresh} disabled={busy}>
          <Icons.reload />
        </IconButton>
        <Button variant="primary" onClick={onAdd} disabled={status !== 'ready'}>
          Add a file
        </Button>
      </div>
    </div>
  )
}

const KIND_OPTIONS: readonly { id: LibraryKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'other', label: 'Other' },
]

function Filters({
  filter,
  subjects,
  onChange,
}: {
  filter: LibraryFilter
  subjects: readonly string[]
  onChange: (filter: LibraryFilter) => void
}) {
  return (
    <div className="flex flex-col gap-2.5 pb-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            value={filter.query}
            onChange={(query) => onChange({ ...filter, query })}
            placeholder="Search titles, tags, descriptions"
            ariaLabel="Search the library"
          />
        </div>
        <Segmented
          options={KIND_OPTIONS}
          value={filter.kind ?? 'all'}
          onChange={(kind) => onChange({ ...filter, kind: kind === 'all' ? null : kind })}
          ariaLabel="Kind"
          layoutId="library-kind"
        />
      </div>
      {subjects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-muted-foreground">Subject</span>
          {subjects.map((subject) => {
            const on = filter.subject === subject
            return (
              <button
                key={subject}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...filter, subject: on ? null : subject })}
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
        detail="Keep a picture from the composer with the bookmark on its thumbnail, or add a file here."
      />
    )
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.id} item={item} onEdit={onEdit} onRemove={onRemove} />
      ))}
    </ul>
  )
}

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
    <li className="group relative flex flex-col overflow-hidden rounded-lg border bg-surface-raised">
      <button
        type="button"
        onClick={() => onEdit(item)}
        className="flex flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Edit ${item.title}`}
      >
        <Thumbnail item={item} />
        <div className="flex min-w-0 flex-col gap-0.5 p-2.5">
          <p className="truncate text-ui text-foreground" title={item.title}>
            {item.title}
          </p>
          <p className="truncate text-caption text-muted-foreground">
            {item.subject !== '' ? item.subject : item.fileName}
          </p>
          {item.tags.length > 0 ? (
            <p className="truncate text-caption text-muted-foreground/80">{item.tags.join(', ')}</p>
          ) : null}
        </div>
      </button>
      <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100">
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

  if (item.kind === 'image' && src !== null) {
    return <img src={src} alt="" className="aspect-square w-full object-cover" draggable={false} />
  }
  return (
    <span className="flex aspect-square w-full items-center justify-center bg-tint text-muted-foreground">
      {item.kind === 'image' ? <Icons.image /> : <Icons.file />}
    </span>
  )
}

function WhereItLives({ directory }: { directory: string | null }) {
  return (
    <div className="mt-6 border-t pt-4">
      <p className="text-caption text-muted-foreground">
        The files live in <code>{directory ?? '~/.studio/data/library/'}</code>, readable by every
        conversation. The model finds them with its search tool by the words here, then reads a picture or
        a document, or hands a picture to image generation when you ask.
      </p>
    </div>
  )
}
