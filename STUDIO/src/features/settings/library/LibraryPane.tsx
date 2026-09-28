import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_IN, EASE_OUT, SPRING_SNAPPY, staggerDelay } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Button, IconButton, Segmented, TextField } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane } from '@/features/settings/panes/Pane'
import { KeepDialog } from '@/features/library/KeepDialog'
import { base64OfFile, type KeepCandidate } from '@/features/library/client'
import { useLibrary, type LibraryView } from '@/features/settings/library/useLibrary'
import {
  harnessBytesDataUrl,
  libraryBytesPath,
  type LibraryItem,
  type LibraryKind,
} from '@/platform/harness'

/**
 * The library.
 *
 * Everything the person chose to keep beyond one conversation: their own
 * photos, logos, documents and references, each with the words they gave
 * it. The pane is a wall of those files and very little else, because a
 * library is looked at, not read. Four things answer around the wall, and
 * all of them are introduced by their own shape rather than by a label:
 *
 * - **Search** is collapsed until it is asked for. The magnifier is the
 *   whole affordance; the field grows out of it, leftward, into space that
 *   was already there — nothing else on the row moves. Escape, or the same
 *   button, puts it away, and the words go with it.
 * - **Select** turns the wall into a checkbox sheet: a mark appears beside
 *   every card, clicking is selecting, and a small tray rises at the foot
 *   of the window with the count, the delete and the done.
 * - **Kind** narrows what the harness is asked for, as before.
 * - **Add a file** keeps its place, because it is still the one way a
 *   document reaches the library: the composer takes pictures only.
 *
 * The empty library is a pictogram and one short line — a library that
 * holds nothing needs exactly that much said about it, and no more. Error
 * states keep their sentence, because a failure is the one case where the
 * reason is the content.
 */
export function LibraryPane() {
  const library = useLibrary()
  const [adding, setAdding] = useState<KeepCandidate | null>(null)
  const [editing, setEditing] = useState<LibraryItem | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [deleting, setDeleting] = useState(false)
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

  /**
   * The search leaving takes its words with it. A closed magnifier that
   * quietly keeps a stale query would filter the next open — a filter you
   * cannot see is a lie the wall tells.
   */
  const closeSearch = () => {
    setSearching(false)
    if (library.filter.query !== '') library.setFilter({ ...library.filter, query: '' })
  }

  const leaveSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const removeSelected = async () => {
    setDeleting(true)
    const failures: string[] = []
    await Promise.all(
      [...selected].map(async (id) => {
        const error = await library.remove(id)
        if (error !== null) failures.push(error.message)
      }),
    )
    setDeleting(false)
    setSelected(new Set())
    if (failures.length > 0) {
      // What survived stays selected, inside the tray, with the reason; a
      // failed delete is not a finished one.
      setNote(failures[0])
    } else {
      setSelecting(false)
    }
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
        searching={searching}
        selecting={selecting}
        onToggleSearch={() => (searching ? closeSearch() : setSearching(true))}
        onCloseSearch={closeSearch}
        onToggleSelect={() => (selecting ? leaveSelect() : setSelecting(true))}
        onRefresh={() => void library.refresh()}
        onAdd={() => picker.current?.click()}
      />
      <Body
        view={library.view}
        filtered={
          library.filter.query !== '' || library.filter.kind !== null || library.filter.subject !== null
        }
        selecting={selecting}
        selected={selected}
        onToggle={toggleSelected}
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

      <SelectTray
        open={selecting}
        count={selected.size}
        busy={deleting}
        onSelect={() => void removeSelected()}
        onDone={leaveSelect}
      />
    </Pane>
  )
}

/**
 * The pane's one control row. Nothing here has a label it does not wear:
 * the magnifier reads as search, the boxed mark as select, the words
 * All/Images/Documents as the kind. The search's own slot is permanent —
 * its flex slack — so opening it pushes nothing: the pill simply grows
 * leftward out of the button into room that was already there, which is
 * why the gesture reads as the field unfurling rather than the row
 * reshuffling.
 */
function Toolbar({
  library,
  subjects,
  searching,
  selecting,
  onToggleSearch,
  onCloseSearch,
  onToggleSelect,
  onRefresh,
  onAdd,
}: {
  library: ReturnType<typeof useLibrary>
  subjects: readonly string[]
  searching: boolean
  selecting: boolean
  onToggleSearch: () => void
  onCloseSearch: () => void
  onToggleSelect: () => void
  onRefresh: () => void
  onAdd: () => void
}) {
  const { filter, setFilter, view, refreshing } = library
  return (
    <div className="flex flex-col gap-2.5 py-3.5">
      <div className="flex items-center gap-2">
        <Segmented
          options={KIND_OPTIONS}
          value={filter.kind ?? 'all'}
          onChange={(kind) => setFilter({ ...filter, kind: kind === 'all' ? null : kind })}
          ariaLabel="Kind"
          layoutId="library-kind"
        />
        <div className="flex min-w-24 flex-1 justify-end">
          <AnimatePresence initial={false}>
            {searching ? (
              <motion.div
                key="search"
                initial={{ opacity: 0, width: 40 }}
                animate={{ opacity: 1, width: '100%' }}
                exit={{
                  opacity: 0,
                  width: 40,
                  transition: { duration: DURATION.base, ease: EASE_IN },
                }}
                transition={{ duration: DURATION.slow, ease: EASE_OUT }}
                className="min-w-0"
              >
                <TextField
                  value={filter.query}
                  onChange={(query) => setFilter({ ...filter, query })}
                  placeholder="Search the library"
                  ariaLabel="Search the library"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') onCloseSearch()
                  }}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Refresh" onClick={onRefresh} disabled={refreshing}>
            <Icons.reload />
          </IconButton>
          <IconButton label="Search" onClick={onToggleSearch} active={searching}>
            <Icons.search />
          </IconButton>
          <IconButton label="Select" onClick={onToggleSelect} active={selecting}>
            <Icons.select />
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

/**
 * The wall and its one alternative. Both live behind the same presence so
 * the handovers are moves rather than swaps: the wall dissolving as the
 * empty pictogram rises into its place, a search that lost giving the wall
 * back.
 */
function Body({
  view,
  filtered,
  selecting,
  selected,
  onToggle,
  onEdit,
  onRemove,
}: {
  view: LibraryView
  filtered: boolean
  selecting: boolean
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
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
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {items.length === 0 ? (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: DURATION.base, ease: EASE_IN } }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
        >
          <EmptyNote filtered={filtered} />
        </motion.div>
      ) : (
        <motion.ul
          key="wall"
          exit={{
            opacity: 0,
            scale: 0.98,
            transition: { duration: DURATION.base, ease: EASE_IN },
          }}
          className="grid origin-center grid-cols-2 gap-3 py-3.5 sm:grid-cols-3"
        >
          <AnimatePresence initial={true} mode="popLayout">
            {items.map((item, index) => (
              <Card
                key={item.id}
                item={item}
                at={index}
                selecting={selecting}
                selected={selected.has(item.id)}
                onToggle={onToggle}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </AnimatePresence>
  )
}

/**
 * One kept file, drawn as its picture.
 *
 * The card is the thumbnail and one quiet line — the words that describe it
 * are what the dialog edits, and they are one click away. In select mode
 * the click becomes the toggle and a mark appears beside every card, a
 * hollow box until it is picked; the row of them is why the mode exists.
 * Every arriving fades and rises on the house pace, spaced by its
 * position, so the wall arrives as one gesture; every leaving retraces
 * onto the ease-in while its neighbours glide into the gap (`layout`).
 */
function Card({
  item,
  at,
  selecting,
  selected,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: LibraryItem
  at: number
  selecting: boolean
  selected: boolean
  onToggle: (id: string) => void
  onEdit: (item: LibraryItem) => void
  onRemove: (item: LibraryItem) => void
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: DURATION.slow, ease: EASE_OUT, delay: staggerDelay(at) },
      }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: DURATION.base, ease: EASE_IN } }}
      className="group relative flex flex-col"
    >
      <button
        type="button"
        onClick={() => (selecting ? onToggle(item.id) : onEdit(item))}
        aria-pressed={selecting ? selected : undefined}
        className="flex min-w-0 flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={selecting ? `Select ${item.title}` : `Edit ${item.title}`}
      >
        <Thumbnail item={item} />
        <span className="truncate px-0.5 text-caption text-muted-foreground" title={item.title}>
          {item.title}
        </span>
      </button>
      <AnimatePresence>
        {selecting ? (
          <motion.span
            key="mark"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: DURATION.base, ease: EASE_IN } }}
            transition={SPRING_SNAPPY}
            className={
              selected
                ? 'absolute left-1.5 top-1.5 flex size-5.5 items-center justify-center rounded-full bg-foreground text-background shadow-chip'
                : 'absolute left-1.5 top-1.5 flex size-5.5 items-center justify-center rounded-full border border-foreground/40 bg-surface/85 text-foreground shadow-chip backdrop-blur-sm'
            }
          >
            {selected ? <Icons.check size="xs" /> : null}
          </motion.span>
        ) : (
          <div
            key="remove"
            className="absolute right-1.5 top-1.5 rounded-full bg-surface/85 p-0.5 opacity-0 shadow-chip backdrop-blur-sm transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <IconButton label={`Remove ${item.title}`} onClick={() => onRemove(item)}>
              <Icons.delete />
            </IconButton>
          </div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/**
 * An empty library, said with a pictogram and — because a page of nothing
 * still wants one witness — one short line. Which line depends on why it
 * is empty: nothing kept, or nothing by that words.
 */
function EmptyNote({ filtered }: { filtered: boolean }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-10">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-tint text-muted-foreground/60"
      >
        <Icons.library size="lg" />
      </span>
      <p className="text-caption text-muted-foreground">
        {filtered ? 'Nothing matches.' : 'Nothing kept yet.'}
      </p>
    </div>
  )
}

/**
 * The select tray, risen to the foot of the window while the mode lasts.
 * It is a popover on its side — the same blurred ground, the same hairline
 * and overlay shadow — because it is the same idea: a small surface of
 * verbs, summoned, that leaves when its work is done. It never overlaps
 * the wall: the library ends well above the window's foot, and the tray
 * rides the whole column's centreline, where the eye already is.
 */
function SelectTray({
  open,
  count,
  busy,
  onSelect,
  onDone,
}: {
  open: boolean
  count: number
  busy: boolean
  onSelect: () => void
  onDone: () => void
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="tray"
          initial={{ opacity: 0, y: 14, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{
            opacity: 0,
            y: 14,
            x: '-50%',
            transition: { duration: DURATION.base, ease: EASE_IN },
          }}
          transition={SPRING_SNAPPY}
          className="fixed bottom-6 left-1/2 z-40"
        >
          <div className="studio-blur flex items-center gap-1 rounded-lg border p-1 shadow-overlay">
            <span role="status" className="pl-2 pr-1 text-caption text-muted-foreground">
              {count} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelect}
              busy={busy}
              disabled={count === 0}
            >
              Delete
            </Button>
            <Button variant="primary" size="sm" onClick={onDone}>
              Done
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * The picture itself: its bytes, fetched once and kept by the browser's
 * cache, falling back to the kind's own mark while they travel — the tinted
 * square a non-image keeps permanently, because the alternative (a foreign
 * document rendered as an anniversary of an image) is a promise the file
 * cannot keep.
 */
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
