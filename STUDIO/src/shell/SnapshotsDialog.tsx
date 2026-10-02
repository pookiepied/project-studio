import { useCallback, useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/icons'
import { Dialog, IconButton } from '@/components/primitives'
import { StateNote } from '@/components/state/StateNote'
import {
  useHarnessClient,
  type HarnessFailure,
  type SnapshotRecord,
} from '@/platform/harness'

/**
 * The project's undo history, for the conversation that is open.
 *
 * Every write-bearing turn leaves a point here, and restoring returns the
 * project to one. It lives beside the conversation rather than in Settings,
 * because undo is wanted in the middle of the work it undoes - the same
 * reasoning that put the conversation's extension scope on the identity
 * line. The harness keeps an undo point of the state being left behind on
 * every restore, so nothing here is beyond taking back.
 */

type SnapshotsView =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'no-harness' }
  | { readonly status: 'failed'; readonly error: HarnessFailure }
  | { readonly status: 'ready'; readonly snapshots: readonly SnapshotRecord[] }

function formatTakenAt(takenAt: number): string {
  return new Date(takenAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function SnapshotsDialog({
  conversation,
  onClose,
}: {
  /** Null when the dialog is closed. Doubles as the open flag. */
  conversation: { readonly id: string; readonly title: string | null } | null
  onClose: () => void
}) {
  const connect = useHarnessClient()
  const [view, setView] = useState<SnapshotsView>({ status: 'idle' })
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The conversation the open read belongs to, so a flip between
  // conversations cannot answer one with the other's history.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const read = useCallback(
    async (conversationId: string) => {
      const harness = await connect()
      if (!live.current) return
      if (harness === null) {
        setView({ status: 'no-harness' })
        return
      }
      setView({ status: 'loading' })
      const result = await harness.conversationSnapshots(conversationId)
      if (!live.current) return
      if (!result.ok) {
        setView({ status: 'failed', error: result.error })
        return
      }
      setView({ status: 'ready', snapshots: result.value })
    },
    [connect],
  )

  useEffect(() => {
    setNote(null)
    setError(null)
    setRestoringId(null)
    if (conversation === null) {
      setView({ status: 'idle' })
      return
    }
    void read(conversation.id)
  }, [conversation, read])

  const restore = useCallback(
    async (conversationId: string, snapshot: SnapshotRecord) => {
      const harness = await connect()
      if (harness === null) {
        setError('The harness is not running.')
        return
      }
      setRestoringId(snapshot.id)
      setError(null)
      const result = await harness.restoreConversationSnapshot(conversationId, snapshot.id)
      if (!live.current) return
      setRestoringId(null)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      // Said with the labels, because the labels are how the history reads:
      // what was returned to, and the name the abandoned state now carries.
      setNote(
        `Returned to “${snapshot.label}”. The state just left is kept as “${result.value.undo.label}”.`,
      )
      await read(conversationId)
    },
    [connect, read],
  )

  return (
    <Dialog
      open={conversation !== null}
      onClose={() => {
        setError(null)
        setNote(null)
        onClose()
      }}
      title="Project history"
      width="30rem"
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-caption text-muted-foreground">
          What the agent wrote left a point here before it wrote. Restoring returns the project to
          one; the state being left behind is always kept first.
        </p>

        {view.status === 'idle' || view.status === 'loading' ? (
          <p className="py-2 text-ui text-muted-foreground" role="status" aria-label="Loading history">
            Reading the recorded points.
          </p>
        ) : null}

        {view.status === 'no-harness' ? (
          <StateNote
            title="The harness is not running."
            detail="The history is kept by the harness, so it cannot be read until it starts."
          />
        ) : null}

        {view.status === 'failed' ? (
          <StateNote title="The history could not be read." detail={view.error.message} />
        ) : null}

        {view.status === 'ready' && view.snapshots.length === 0 ? (
          <p className="py-2 text-ui text-muted-foreground">
            Nothing recorded yet. A point appears here the first time a turn in this conversation
            writes to the project.
          </p>
        ) : null}

        {view.status === 'ready' && view.snapshots.length > 0 ? (
          <div className="flex flex-col divide-y">
            {view.snapshots.map((snapshot) => (
              <div key={snapshot.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui text-foreground">{snapshot.label}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {formatTakenAt(snapshot.takenAt)}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  <IconButton
                    label={`Restore to ${snapshot.label}`}
                    disabled={restoringId !== null}
                    onClick={() => {
                      if (conversation !== null) void restore(conversation.id, snapshot)
                    }}
                  >
                    <Icons.undo />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {note !== null ? (
          <p role="status" className="text-caption text-muted-foreground">
            {note}
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
