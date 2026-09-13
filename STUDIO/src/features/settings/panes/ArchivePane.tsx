import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { Placeholder, PlaceholderText } from '@/components/placeholder'
import { RetryButton, StateNote } from '@/components/state'
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
 * listed for a person's sweep and never swept by the app - nothing here
 * deletes on its own.
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
  const [sweeping, setSweeping] = useState(false)
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

  const purge = async (ids: readonly string[]) => {
    if (purging) return
    setPurging(true)
    setPurgeFailures({})
    try {
      const failures = await removeMany(ids)
      setPurgeFailures(failures)
      setSelected(new Set())
      // A tree the purge could not fully remove is the sweep's shape now.
      await refreshOrphanTrees()
    } finally {
      setPurging(false)
    }
  }

  const sweep = async () => {
    if (sweeping) return
    setSweeping(true)
    setSweepFailure(null)
    setSweepFailures({})
    try {
      const outcome = await sweepOrphanTrees()
      if (!outcome.ok) setSweepFailure(outcome.error)
      else setSweepFailures(outcome.value)
    } finally {
      setSweeping(false)
    }
  }

  const retry = <RetryButton onRetry={ensureStore} />

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
            Deleting removes the conversation, its files and its transcript. It cannot be
            undone.
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

      {storePhase.status === 'ready' && orphanTrees.length > 0 ? (
        <div className="flex flex-col gap-2 border-t py-2.5">
          <p className="text-caption text-muted-foreground">
            {/* The pronoun belongs to the branch that set the number. Written
                as a shared tail it said "One leftover folder ... Removing
                them", which is the sentence a person reads when they have
                exactly one. */}
            {orphanTrees.length === 1
              ? 'One leftover folder from a conversation that is already gone. Removing it deletes the files.'
              : `${orphanTrees.length} leftover folders from conversations that are already gone. Removing them deletes the files.`}{' '}
            This cannot be undone.
          </p>
          <div>
            <Button variant="danger" size="sm" busy={sweeping} onClick={() => void sweep()}>
              Remove leftover folders
            </Button>
          </div>
          {sweepFailure ? (
            <p role="alert" className="text-caption text-danger">
              {sweepFailure.message}
            </p>
          ) : null}
          {Object.entries(sweepFailures).map(([name, message]) => (
            <p key={name} role="alert" className="text-caption text-danger">
              {message}
            </p>
          ))}
        </div>
      ) : null}
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
          <PlaceholderText width={width} className="text-ui" />
          <Placeholder className="h-7 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}
