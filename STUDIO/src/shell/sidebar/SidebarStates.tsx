import { useState } from 'react'
import { Button } from '@/components/primitives'
import { PlaceholderText } from '@/components/placeholder'
import { StateNote } from '@/components/state'
import type { StorePhase } from '@/stores/workspace'
import type { SidebarOrganize } from '@/stores/navigation'

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
 * The states are drawn here, at the column, because the column is where the
 * absence is visible:
 *
 * - **loading** holds the rows' shape -- same padding, same rhythm, widths
 *   varied the way titles vary -- so the arrival of the real list is a change
 *   of fill, not a jump.
 * - **no-harness** and **failed** keep whatever local rows exist (the gallery
 *   is always among them) and say, above them, why the rest is not here, with
 *   the remedy the chat pane already offered. A column that renders nothing
 *   makes the app look empty; a column that says "the harness is not running"
 *   makes the app look like what it is.
 */

/** Row widths, varied on purpose: a column of equal bars reads as a pattern. */
const LIST_WIDTHS = ['58%', '41%', '66%', '37%', '55%', '48%', '63%', '44%'] as const

const GROUP_WIDTHS = [
  ['42%', '61%', '38%', '55%'],
  ['36%', '52%', '44%'],
] as const

export function SidebarSkeleton({ organize }: { organize: SidebarOrganize }) {
  return (
    <div role="status" aria-label="Loading conversations" className="pt-1.5">
      {organize === 'list' ? (
        <div className="flex flex-col gap-1">
          {LIST_WIDTHS.map((width) => (
            <SkeletonRow key={width} width={width} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {GROUP_WIDTHS.map((rows, group) => (
            <div key={group} className="flex flex-col">
              <SkeletonRow width={rows[0]} header />
              <div className="ml-3 flex flex-col gap-1">
                {rows.slice(1).map((width) => (
                  <SkeletonRow key={width} width={width} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SkeletonRow({ width, header = false }: { width: string; header?: boolean }) {
  return (
    <div
      className={`flex items-center rounded-md py-1 text-ui ${header ? 'pl-1.5' : 'pl-2'}`}
    >
      <PlaceholderText className={width} />
    </div>
  )
}

/**
 * The column's answer to a store it cannot read.
 *
 * `ensureStore` asks the supervisor to start the harness and re-reads when it
 * does -- the same remedy the chat pane's notice offers, offered here because
 * the absence is visible here first: the sidebar is on screen before any
 * conversation is.
 */
export function SidebarUnavailable({
  phase,
  onEnsure,
}: {
  phase: StorePhase
  onEnsure: () => Promise<boolean>
}) {
  const [asking, setAsking] = useState(false)

  if (phase.status === 'no-harness') {
    return (
      <StateNote
        className="px-1 py-3"
        title="The harness is not running."
        detail="Conversations live in the harness, so the list cannot be read until it starts."
        action={
          <Button
            variant="secondary"
            size="sm"
            busy={asking}
            onClick={() => {
              setAsking(true)
              void onEnsure().finally(() => setAsking(false))
            }}
          >
            Start the harness
          </Button>
        }
      />
    )
  }

  return (
    <StateNote
      className="px-1 py-3"
      title="Could not read the conversations."
      detail={phase.error?.message ?? 'The harness stopped answering.'}
      action={
        <Button
          variant="secondary"
          size="sm"
          busy={asking}
          onClick={() => {
            setAsking(true)
            void onEnsure().finally(() => setAsking(false))
          }}
        >
          Try again
        </Button>
      }
    />
  )
}
