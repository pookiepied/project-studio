import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { Loading, RetryButton, StateNote } from '@/components/state'
import type { HarnessFailure } from '@/platform/harness'
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
 * `removeMany` asks the harness to purge: the journal rows in Flue's journal,
 * the conversation-scoped rows, the index row, and that conversation's own
 * tree under `~/.studio/data/conversations/` go, content first and the row
 * last so a crash stays deletable - see
 * `STUDIO HARNESS/src/conversations/purge.ts`. A conversation with a turn in
 * flight is refused and stays listed, with the harness's sentence beside it
 * rather than a paraphrase.
 *
 * ---- What the leftover folders are -----------------------------------------
 *
 * Trees an earlier partial delete left behind: the index row is gone, so the
 * purge cannot target them, and no journal stream owns them either. They are
 * not a separate chore: every delete here ends by sweeping them, so a person
 * has one button to empty the archive and nothing left over to find. When
 * only leftovers remain, the same Clear archive button is what removes them.
 * Nothing here deletes on its own, without a click.
 *
 * ---- Why the empty sentence is gated on ready ------------------------------
 *
 * "Nothing archived." is a fact only a read conversation can state. While the
 * index is in flight the pane held the rows' shape, and when a read failed it
 * said why -- because a pane that answers "nothing" while the answer is still
 * arriving is indistinguishable from one that lost the archive.
 */
export function ArchivePane() {
  const {
    conversations,
    storePhase,
    ensureStore,
    setArchived,
    removeMany,
    orphanTrees,
    refreshOrphanTrees,
    sweepOrphanTrees,
  } = useWorkspace()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [purging, setPurging] = useState(false)
  const [purgeFailures, setPurgeFailures] = useState<Readonly<Record<string, string>>>({})
  const [sweepFailure, setSweepFailure] = useState<HarnessFailure | null>(null)
  const [sweepFailures, setSweepFailures] = useState<Readonly<Record<string, string>>>({})

  const archived = conversations
    .filter((conversation) => conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  useEffect(() => {
    if (storePhase.status === 'ready') void refreshOrphanTrees()
  }, [storePhase.status, refreshOrphanTrees])

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Deletes the conversations, then sweeps whatever folders a delete - this
   * one or an earlier one - left behind. One act, so a person never meets a
   * second button for the remainder of the first.
   */
  const purge = async (ids: readonly string[]) => {
    if (purging) return
    setPurging(true)
    setPurgeFailures({})
    setSweepFailure(null)
    setSweepFailures({})
    try {
      if (ids.length > 0) {
        setPurgeFailures(await removeMany(ids))
        setSelected(new Set())
      }
      const outcome = await sweepOrphanTrees()
      if (!outcome.ok) setSweepFailure(outcome.error)
      else setSweepFailures(outcome.value)
    } finally {
      setPurging(false)
    }
  }

  const retry = <RetryButton onRetry={ensureStore} />

  return (
    <Pane
      title="Archived chats"
      description="Kept for as long as you want them. Nothing here expires."
    >
      {storePhase.status === 'loading' ? (
        <Loading label="Loading the archive" />
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
      ) : archived.length === 0 && orphanTrees.length === 0 ? (
        <p className="py-4 text-ui text-muted-foreground">Nothing archived.</p>
      ) : archived.length === 0 ? (
        <div className="flex items-center justify-between gap-2 py-2.5">
          <span className="text-caption text-muted-foreground">
            {orphanTrees.length === 1
              ? 'Nothing archived, but one folder from a deleted chat is still on disk.'
              : `Nothing archived, but ${orphanTrees.length} folders from deleted chats are still on disk.`}
          </span>
          <Button variant="danger" size="sm" busy={purging} icon={<Icons.clear />} onClick={() => void purge([])}>
            Clear archive
          </Button>
        </div>
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
                  busy={purging}
                  icon={<Icons.delete />}
                  onClick={() => void purge([...selected])}
                >
                  Delete selected
                </Button>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                busy={purging}
                icon={<Icons.clear />}
                onClick={() => void purge(archived.map((conversation) => conversation.id))}
              >
                Clear archive
              </Button>
            </div>
          </div>

          <p className="text-micro text-muted-foreground">
            Deleting removes the conversation, its files and its transcript, and any folders
            an earlier delete left behind. It cannot be undone.
          </p>

          {Object.entries(purgeFailures).map(([id, message]) => (
            <p key={id} role="alert" className="pt-1 text-caption text-danger">
              {message}
            </p>
          ))}

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

      {sweepFailure ? (
        <p role="alert" className="pt-1 text-caption text-danger">
          {sweepFailure.message}
        </p>
      ) : null}
      {Object.entries(sweepFailures).map(([name, message]) => (
        <p key={name} role="alert" className="pt-1 text-caption text-danger">
          {message}
        </p>
      ))}
    </Pane>
  )
}

