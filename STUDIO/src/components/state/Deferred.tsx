import {
  Component,
  Fragment,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { RetryButton } from '@/components/state/RetryButton'
import { StateNote } from '@/components/state/StateNote'

/**
 * A part of the app that arrives when it is first needed.
 *
 * ---- What is deferred, and why -----------------------------------------
 *
 * The bundle used to be one file and a half: everything the app could ever
 * show, loaded before the first paint, including a maths typesetter, a video
 * player's chrome, twenty syntax grammars and four settings panes most
 * sessions never open. `lazy()` at the seam moves each of those into a chunk
 * that is fetched the first time a component asks for it.
 *
 * ---- The waiting state, in one place -----------------------------------
 *
 * A deferred part has two states no eager part has: not here yet, and could
 * not be fetched. Both are drawn here rather than at each seam, so every
 * lazy surface waits and fails the same way.
 *
 * Waiting is a skeleton, after a pause. The chunk is usually local and lands
 * in a few frames; a skeleton that flashed for those frames would be the
 * only thing the person saw of it. So nothing is drawn for `DELAY_MS`, then
 * the caller's skeleton - which is composed from the placeholder primitives
 * where the content is composed, so the handover is a change of fill rather
 * than a jump (`Placeholder`). The region announces itself once, through
 * `role="status"` and the label the caller gives it.
 *
 * Failing is a `StateNote` with a retry. A chunk that cannot be fetched is
 * ordinary at the moment an update replaces the files under a running app,
 * and the remedy is the same as for a failed read: try again. The retry
 * re-mounts the boundary, which asks React to import the chunk again.
 */

/** How long a wait is invisible before the skeleton shows. */
const DELAY_MS = 150

export function Deferred({
  fallback,
  label,
  children,
}: {
  /** The skeleton of the content, composed where the content is composed. */
  fallback: ReactNode
  /** What is loading, for the status region: "Settings", "Video player". */
  label: string
  children: ReactNode
}) {
  return (
    <ChunkBoundary label={label}>
      <Suspense fallback={<Delayed label={label}>{fallback}</Delayed>}>{children}</Suspense>
    </ChunkBoundary>
  )
}

/**
 * `lazy()` for a module's named export, since the seams here export by name
 * and `lazy` wants a default. One line per lazy component at the call site:
 *
 *   const VideoPlayer = lazyNamed(() => import('./VideoPlayer'), 'VideoPlayer')
 */
export function lazyNamed<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): M[K] extends ComponentType<infer P> ? ComponentType<P> : never {
  return lazy(async () => {
    const module = await load()
    return { default: module[name] as ComponentType<unknown> }
  }) as never
}

function Delayed({ label, children }: { label: string; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  if (!shown) return null
  return (
    <div role="status" aria-label={`Loading ${label}`} className="contents">
      {children}
    </div>
  )
}

interface BoundaryState {
  readonly failed: boolean
  /** Bumped by a retry, so the subtree remounts and the import runs again. */
  readonly attempt: number
}

class ChunkBoundary extends Component<{ label: string; children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false, attempt: 0 }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The one place a chunk failure is reported. Not swallowed: a developer
    // reading the console should see it; a person reading the page sees the
    // note below instead of a blank.
    console.error(`[deferred] ${this.props.label} could not be loaded.`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <StateNote
          title={`${this.props.label} could not be loaded.`}
          detail="The part of the app it needs did not arrive. This usually clears on a retry."
          action={
            <RetryButton
              onRetry={() => {
                this.setState((current) => ({ failed: false, attempt: current.attempt + 1 }))
                return Promise.resolve()
              }}
            />
          }
          className="px-4"
        />
      )
    }
    // Keyed on the attempt so a retry mounts the subtree afresh and re-imports.
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
