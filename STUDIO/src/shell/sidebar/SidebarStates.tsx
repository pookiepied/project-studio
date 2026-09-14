import { Loading, RetryButton, StateNote } from '@/components/state'
import type { StorePhase } from '@/stores/workspace'

/**
 * What the conversation column shows when the index it lists is not a list.
 *
 * ---- Where these states were before ----------------------------------------
 *
 * The store has always had a phase (`StorePhase`: loading, ready, no-harness,
 * failed); nothing read it. While the index was in flight the column rendered
 * as if it were empty, and when a read failed it rendered exactly the same
 * nothing -- a broken harness and an empty sidebar were one blank column, and
 * the store's own answer to that ambiguity was never shown.
 *
 * - **loading** draws nothing and announces itself (`Loading`); the rows
 *   arrive. It held the rows' shape for a while, as bars, and then the
 *   app's dots; both were refused here for what they were, a widget where
 *   the list should be.
 * - **failed** keeps whatever local rows exist (the gallery is always among
 *   them) and says, above them, why the rest is not here. A column that
 *   renders nothing makes the app look empty; a column that names the read
 *   that broke makes the app look like what it is.
 *
 * **no-harness** renders nothing here any more. It used to be a block between
 * Search and the list it explained, which pushed the column's content around
 * and filed an app-wide fact under the navigation. The absence now states
 * itself once, in the home surface's status pill -- which also carries the
 * supervisor's reason and the control that starts the harness -- so the column
 * keeps whatever local rows exist and says nothing it cannot be the first to
 * know.
 */

export function SidebarLoading() {
  return <Loading label="Loading conversations" />
}

/**
 * The column's answer to a store it cannot read.
 *
 * `ensureStore` asks the supervisor to start the harness and re-reads when it
 * does. The absent-harness case is deliberately not rendered here -- that
 * sentence lives in the home surface's status pill, which owns the reason and
 * the remedy for the whole app -- so a phase of `no-harness` leaves the column
 * to its local rows.
 */
export function SidebarUnavailable({
  phase,
  onEnsure,
}: {
  phase: StorePhase
  onEnsure: () => Promise<boolean>
}) {
  if (phase.status === 'no-harness') return null

  return (
    <StateNote
      className="px-1 py-3"
      title="Could not read the conversations."
      detail={phase.error?.message ?? 'The harness stopped answering.'}
      action={<RetryButton onRetry={onEnsure} />}
    />
  )
}
