import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { Placeholder, PlaceholderText } from '@/components/placeholder'
import { StateNote } from '@/components/state'
import { useWorkspace } from '@/stores/workspace'
import { Pane } from '@/features/settings/panes/Pane'
import { cn } from '@/lib/cn'

/**
 * Archived chats.
 *
 * Archiving keeps a conversation indefinitely — there is no thirty-day sweep,
 * and the copy says so, because an archive that quietly deletes is the one
 * feature nobody forgives. Deleting is a separate, explicit act, available one
 * at a time or over a selection.
 *
 * Selection is here rather than a per-row delete because the reason to visit
 * this pane at all is usually to clear several things at once.
 *
 * ---- What the buttons actually destroy -------------------------------------
 *
 * `removeMany` asks the harness to purge: the index row and that
 * conversation's own tree under `~/.studio/data/conversations/` go; the
 * canonical transcript inside Flue's journal has no supported deletion
 * surface, so nothing pretends otherwise — see
 * `STUDIO HARNESS/src/conversations/purge.ts`. The rows are removed first,
 * which means there is no half-deleted state in the sidebar afterwards even
 * when files were locked mid-turn and reported back as unremovable.
 *
 * ---- Why the empty sentence is gated on ready ------------------------------
 *
 * "Nothing archived." is a fact only a read conversation can state. While the
 * index is in flight the pane held the rows' shape, and when a read failed it
 * said why -- because a pane that answers "nothing" while the answer is still
 * arriving is indistinguishable from one that lost the archive.
 */
export function ArchivePane() {
  const { conversations, storePhase, ensureStore, setArchived, removeMany } = useWorkspace()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState(false)

  const archived = conversations
    .filter((conversation) => conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const retry = (
    <Button
      variant="secondary"
      size="sm"
      busy={asking}
      onClick={() => {
        setAsking(true)
        void ensureStore().finally(() => setAsking(false))
      }}
    >
      Try again
    </Button>
  )

  return (
    <Pane
      title="Archived chats"
      description="Kept for as long as you want them. Nothing here expires."
    >
      {storePhase.status === 'loading' ? (
        <ArchiveSkeleton />
      ) : storePhase.status === 'no-harness' ? (
        <StateNote
          title="The harness is not running."
          detail="The archive lives in the harness, so there is nothing to read until it starts."
          action={retry}
        />
      ) : storePhase.status === 'failed' ? (
        <StateNote
          title="Could not read the archive."
          detail={storePhase.error?.message ?? 'The harness stopped answering.'}
          action={retry}
        />
      ) : archived.length === 0 ? (
        <p className="py-4 text-ui text-muted-foreground">Nothing archived.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 py-2.5">
            <span className="text-caption text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selected` : `${archived.length} conversations`}
            </span>
            <div className="flex items-center gap-1.5">
              {selected.size > 0 ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Icons.delete />}
                  onClick={() => {
                    removeMany([...selected])
                    setSelected(new Set())
                  }}
                >
                  Delete selected
                </Button>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                icon={<Icons.clear />}
                onClick={() => {
                  removeMany(archived.map((conversation) => conversation.id))
                  setSelected(new Set())
                }}
              >
                Clear archive
              </Button>
            </div>
          </div>

          <div className="flex flex-col divide-y">
            {archived.map((conversation) => {
              const checked = selected.has(conversation.id)
              return (
                <div key={conversation.id} className="flex items-center gap-2.5 py-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`Select ${conversation.title ?? 'conversation'}`}
                    onClick={() => toggle(conversation.id)}
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors duration-fast',
                      checked
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'hover:border-foreground/30',
                    )}
                  >
                    {checked ? <Icons.check /> : null}
                  </button>

                  <span className="min-w-0 flex-1 truncate text-ui text-foreground">
                    {conversation.title ?? 'Untitled'}
                  </span>

                  <Button variant="secondary" size="sm" onClick={() => setArchived(conversation.id, false)}>
                    Restore
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Pane>
  )
}

/**
 * The archive's rows, before the archive arrives: checkbox, title, restore --
 * the real row's exact cast, holding its shape.
 */
function ArchiveSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the archive"
      className="flex flex-col divide-y"
    >
      {['44%', '61%', '38%', '52%'].map((width) => (
        <div key={width} className="flex items-center gap-2.5 py-2.5">
          <Placeholder className="size-4 shrink-0 rounded-xs" />
          <PlaceholderText className={`text-ui ${width}`} />
          <Placeholder className="h-7 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}
