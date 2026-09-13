import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@/platform/tauri/window'

/** The lifecycle events the supervisor emits, normalised to a name plus raw payload. */
export interface LifecycleSignal {
  readonly name:
    | 'harness-starting'
    | 'harness-started'
    | 'harness-stopped'
    | 'harness-failed'
    | 'harness-restarting'
  readonly payload?: unknown
}

/** Subscribes to lifecycle events; resolves with the unsubscriber. */
export type LifecycleListen = (
  handler: (signal: LifecycleSignal) => void,
) => Promise<() => void>

const LIFECYCLE_EVENTS = [
  'harness-starting',
  'harness-started',
  'harness-stopped',
  'harness-failed',
  'harness-restarting',
] as const

/**
 * The real lifecycle subscription.
 *
 * Here rather than beside either of its two callers: the conversation hook
 * re-attaches on these events and the workspace store re-reads the index on
 * them (a restart may have moved the endpoint). It used to live in the hook,
 * which meant the store imported a feature -- a dependency pointing the
 * wrong way -- and re-declaring the list in the store instead is how two
 * copies start disagreeing. The list is a fact about the supervisor, which
 * makes it the platform's.
 */
export const defaultListen: LifecycleListen = (handler) => {
  if (!isTauri()) {
    // A browser has no event bus to subscribe to: the supervisor emits these
    // into the desktop webview, not over HTTP. An empty subscription that
    // resolves with a no-op unsubscriber keeps the caller's shape; a browser
    // notices a stopped or restarted harness when its next contact or request
    // fails, which is how it notices everything.
    return Promise.resolve(() => undefined)
  }
  const subscriptions = LIFECYCLE_EVENTS.map((name) =>
    listen<unknown>(name, (event) => handler({ name, payload: event.payload })),
  )
  return Promise.all(subscriptions).then((unlisten) => () =>
    unlisten.forEach((off) => off()),
  )
}
