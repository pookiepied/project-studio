import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { GALLERY_CONVERSATION_ID, galleryConversation } from '@/domain/conversation/gallery'
import type { Conversation } from '@/domain/conversation/types'
import type { Project } from '@/domain/projects/types'
import { detachedConversationId } from '@/platform/tauri'
import {
  createHarnessClient,
  harnessIsStarting,
  resolveHarnessAddress,
  startHarness,
  type HarnessClient,
} from '@/platform/harness'
import { defaultListen } from '@/platform/harness/lifecycle'
import { readHandoff } from '@/stores/workspace/handoff'
import { EMPTY_CATALOG, catalogState, mapProject, mapRecord } from '@/stores/workspace/records'
import { createTitleRefresh } from '@/stores/workspace/title-refresh'
import type { ModelCatalogState, StorePhase } from '@/stores/workspace/types'

/**
 * The index, and how it stays true to the harness.
 *
 * ---- Where conversations live ----------------------------------------------
 *
 * In the harness. The store used to seed every conversation and project from
 * `DEMO_CONVERSATIONS` and `DEMO_PROJECTS`, which meant a reload lost the
 * whole sidebar. It reads the index (`GET /api/conversations`,
 * `/api/projects`) on mount and whenever the harness comes up, and writes
 * every change through it. Transcripts were never here - the conversation view
 * projects Flue's stream directly - so what crosses the seam is exactly what
 * an index holds: existence, title, filing, flags, recency.
 *
 * The load phases answer the two questions a real network asks - not loaded
 * YET, and could not be loaded - as different states, mirroring
 * `useConversation`'s phase machine rather than inventing a third shape.
 *
 * One thing stays local on purpose: the artifact gallery is a display of
 * renderers, not a conversation. It has no stream to index, so it never
 * becomes a row in the harness's store, and it takes no messages.
 *
 * This hook owns the reading side: the client, the load, the re-read on a
 * harness restart, and the one re-read that catches a harness-written title.
 * The writes live beside it (`useConversationWrites`, `useProjectWrites`) and
 * reach the harness through the handle this returns.
 */
/**
 * How long a start is waited for before it is reported as an absence.
 *
 * A cold start is ready in two to four seconds on this machine; a start
 * that has run this long is one something is wrong with, and the person
 * needs the page that lets them press start, not a splash.
 */
const STARTING_DEADLINE_MS = 8_000

export interface HarnessSync {
  /** The client for the harness at its current address, or null while it is away. */
  readonly clientRef: RefObject<HarnessClient | null>
  /** False once the owning component unmounted; every async landing checks it. */
  readonly liveRef: RefObject<boolean>
  /** Re-reads the whole index and the catalog. */
  readonly load: () => Promise<void>
  /** Offers to start the harness, and re-reads when it comes up. */
  readonly ensureStore: () => Promise<boolean>
  /** Arms the title re-read for a conversation this window began. */
  readonly trackTitle: (conversationId: string) => void
  /** A conversation this window began has settled its first exchange. */
  readonly settledTitle: (conversationId: string) => void

  readonly remoteConversations: readonly Conversation[]
  readonly setRemoteConversations: Dispatch<SetStateAction<readonly Conversation[]>>
  readonly localConversations: readonly Conversation[]
  readonly setLocalConversations: Dispatch<SetStateAction<readonly Conversation[]>>
  readonly remoteProjects: readonly Project[]
  readonly setRemoteProjects: Dispatch<SetStateAction<readonly Project[]>>
  readonly storePhase: StorePhase
  readonly catalog: ModelCatalogState
}

export function useHarnessSync(): HarnessSync {
  // A detached window opens with the workspace its opening window saw, not
  // with an empty column while the harness answers. Read once for the life of
  // the window: it is a birth certificate, not a subscription.
  const [seed] = useState(() => (detachedConversationId() ? readHandoff() : null))

  const [remoteConversations, setRemoteConversations] = useState<readonly Conversation[]>(
    () => (seed?.conversations ?? []).filter((item) => item.id !== GALLERY_CONVERSATION_ID),
  )
  const [remoteProjects, setRemoteProjects] = useState<readonly Project[]>(
    () => seed?.projects ?? [],
  )
  const [localConversations, setLocalConversations] = useState<readonly Conversation[]>(() => [
    galleryConversation(),
  ])
  const [storePhase, setStorePhase] = useState<StorePhase>({ status: 'loading', error: null })
  const [catalog, setCatalog] = useState<ModelCatalogState>(EMPTY_CATALOG)

  const clientRef = useRef<HarnessClient | null>(null)
  const liveRef = useRef(true)
  const titleRefreshRef = useRef<ReturnType<typeof createTitleRefresh> | null>(null)
  /** When this store first saw the harness starting; null once it is not. */
  const startingSince = useRef<number | null>(null)
  const startingTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    let client = clientRef.current
    if (client === null) {
      const address = await resolveHarnessAddress()
      if (!liveRef.current) return
      if (address === null) {
        // A harness still coming up is not absent. The supervisor starts it
        // at launch and it takes a second or two; read as an absence, every
        // cold start opened on "the harness is not running" and then jumped
        // to the app when `harness-started` arrived. The store stays
        // `loading` through the start - the lifecycle subscription below
        // re-reads on the start's end, whichever way it ends.
        //
        // But not forever. A wait with no end is the false reassurance the
        // old "not running" page at least never gave: the person cannot
        // press start on a splash. Past `STARTING_DEADLINE_MS` a start that
        // has not ended is reported as an absence, and the page that shows
        // has the start button, which asks the supervisor again.
        if (await harnessIsStarting()) {
          if (!liveRef.current) return
          const now = performance.now()
          startingSince.current ??= now
          const waited = now - startingSince.current
          if (waited < STARTING_DEADLINE_MS) {
            if (startingTimer.current !== null) window.clearTimeout(startingTimer.current)
            startingTimer.current = window.setTimeout(() => {
              startingTimer.current = null
              if (liveRef.current) void load()
            }, STARTING_DEADLINE_MS - waited)
            return
          }
        }
        if (!liveRef.current) return
        // Said differently from a failure: nothing is wrong except absence.
        setStorePhase((current) =>
          current.status === 'loading' ? { status: 'no-harness', error: null } : current,
        )
        setCatalog((current) =>
          current.phase.status === 'loading'
            ? { ...current, phase: { status: 'no-harness', error: null } }
            : current,
        )
        return
      }
      client = createHarnessClient(address)
      clientRef.current = client
    }
    startingSince.current = null

    // The catalog rides the same client and the same restart events as the
    // index, but answers for itself: a picker that cannot be read is the
    // picker's failure to show, not the sidebar's.
    const [conversations, projects, connections, models, defaults] = await Promise.all([
      client.listConversations(),
      client.listProjects(),
      client.listConnections(),
      client.listModels(),
      client.getDefaults(),
    ])
    if (!liveRef.current) return

    setCatalog((current) => catalogState(current, connections, models, defaults))

    if (!conversations.ok) {
      setStorePhase({ status: 'failed', error: conversations.error })
      return
    }
    if (!projects.ok) {
      setStorePhase({ status: 'failed', error: projects.error })
      return
    }

    // Local copies under ids the store holds are dropped: the row is the
    // truth. Local-only records survive; they exist because their writes
    // have not landed yet or belong to something the store will never hold.
    const storedIds = new Set(conversations.value.map((record) => record.id))
    setLocalConversations((current) =>
      current.filter((item) => item.id === GALLERY_CONVERSATION_ID || !storedIds.has(item.id)),
    )

    setRemoteConversations(conversations.value.map(mapRecord))
    setRemoteProjects(projects.value.map(mapProject))
    setStorePhase({ status: 'ready', error: null })
  }, [])

  // The harness names conversations on its own after their first exchange
  // settles (see title-refresh). This window witnesses that settlement only
  // through the running mark, so the one re-read that catches the new title
  // is armed here, once per conversation this window began.
  if (titleRefreshRef.current === null) {
    titleRefreshRef.current = createTitleRefresh({
      refresh: () => {
        void load()
      },
    })
  }
  useEffect(() => {
    const titleRefresh = titleRefreshRef.current
    return () => {
      titleRefresh?.dispose()
    }
  }, [])
  const trackTitle = useCallback((conversationId: string) => {
    titleRefreshRef.current?.track(conversationId)
  }, [])
  const settledTitle = useCallback((conversationId: string) => {
    titleRefreshRef.current?.settled(conversationId)
  }, [])

  useEffect(() => {
    liveRef.current = true
    void load()
    return () => {
      liveRef.current = false
      if (startingTimer.current !== null) window.clearTimeout(startingTimer.current)
      startingTimer.current = null
    }
  }, [load])

  // When the harness comes back - first start, crash restart, or someone
  // pressing start on Task 34's notice - the index re-reads itself. What is
  // on screen while it is down stays: losing connection to the store does not
  // mean forgetting what it had.
  useEffect(() => {
    const restartLoad = (): void => {
      // The endpoint may have moved with the restart.
      clientRef.current = null
      setStorePhase((current) =>
        current.status === 'ready' ? { status: 'loading', error: null } : current,
      )
      void load().then(() => undefined)
    }
    let unlisten: (() => void) | null = null
    let disposed = false
    void defaultListen((signal) => {
      // A start's end is a reason to read again whichever way it went: a
      // store holding `loading` through the start has to learn that the
      // start failed, or it holds forever.
      if (
        signal.name === 'harness-starting' ||
        signal.name === 'harness-started' ||
        signal.name === 'harness-failed' ||
        signal.name === 'harness-stopped'
      ) {
        restartLoad()
      }
    })
      .then((off) => {
        if (disposed) off()
        else unlisten = off
        // A catch-up read, because a Tauri event is not replayed to a
        // subscriber that arrived after it was emitted.
        //
        // The supervisor starts the harness eagerly at launch and announces
        // `harness-started` the moment it is ready. Subscribing is async and
        // so is the `load()` above, and both begin at mount: on a cold start
        // the harness can come up in the gap between that load reading
        // `starting` - which resolves to no address at all - and this
        // subscription existing. The event is then emitted to nobody, and
        // nothing reads again, so the window says the harness is not running
        // while it is up and serving. Measured on this machine at about two
        // seconds between the app starting and the harness being ready, which
        // a webview booting from a cold file cache loses easily.
        //
        // Reading once here closes the window by construction: anything that
        // could have been missed happened before this point, and this happens
        // after it. Only when there is no client - a store that already
        // resolved an address has nothing to catch up on, and re-reading
        // would refetch the whole index for nothing.
        if (!disposed && liveRef.current && clientRef.current === null) {
          void load().then(() => undefined)
        }
      })
      // Subscribing is best effort. Outside the desktop shell there is no
      // event bridge to subscribe to, and the rejection has to be swallowed
      // here rather than left to the platform: unhandled, it is six noisy
      // failures under the test runner and a console error in a browser, for
      // an absence the store already handles as `no-harness`.
      .catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [load])

  const ensureStore = useCallback(async (): Promise<boolean> => {
    const cameUp = await startHarness()
    if (cameUp && liveRef.current) {
      clientRef.current = null
      setStorePhase({ status: 'loading', error: null })
      await load()
    }
    return cameUp
  }, [load])

  return {
    clientRef,
    liveRef,
    load,
    ensureStore,
    trackTitle,
    settledTitle,
    remoteConversations,
    setRemoteConversations,
    localConversations,
    setLocalConversations,
    remoteProjects,
    setRemoteProjects,
    storePhase,
    catalog,
  }
}
