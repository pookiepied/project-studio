import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { CatalogModel } from '@/domain/models/catalog'
import { catalogFrom } from '@/domain/models/catalog'
import type { ReasoningChoice } from '@/domain/models/types'
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@/domain/permissions/modes'
import { GALLERY_CONVERSATION_ID, galleryConversation } from '@/domain/session/gallery'
import type { Conversation, SessionStatus, TurnSettings } from '@/domain/session/types'
import type { Project } from '@/domain/projects/types'
import { detachedConversationId } from '@/platform/tauri'
import {
  createHarnessClient,
  executionModeFromWire,
  executionModeToWire,
  resolveHarnessAddress,
  startHarness,
  type ApprovalAnswer,
  type DefaultSelection,
  type ExecutionModeWire,
  type HarnessClient,
  type HarnessFailure,
  type HarnessResult,
  type PendingApprovalRecord,
  type PendingQuestionRecord,
  type PlanSnapshot,
  type ProviderConnection,
} from '@/platform/harness'
import { defaultListen } from '@/features/chat/useConversation'
import { useDemoTurns } from '@/stores/workspace/demo-turns'
import { readHandoff } from '@/stores/workspace/handoff'
import { createTitleRefresh } from '@/stores/workspace/title-refresh'
import { newId } from '@/lib/id'

/**
 * Projects, conversations, and the settings a turn is sent with.
 *
 * ---- Where conversations live now ------------------------------------------
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
 * Two things stay local on purpose:
 *
 * - The artifact gallery is a display of renderers, not a conversation.
 *   `ChatPage` withholds sending for it already; it has no stream to index,
 *   so it never becomes a row in the harness's store either.
 * - The demo turn path (`demo-turns.ts`) keeps answering only for the gallery.
 */
/**
 * The resting turn settings. Null modelId is the harness's own default - the
 * stable alias - which is why there is no model id here to invent, and null
 * is the reasoning state of somebody who has not chosen a level: the window
 * does not know the model's levels here, so it keeps the choice absent and
 * the harness rests the turn on medium rather than the window writing a
 * level the user did not pick. A second notion of "the default model" living
 * in the webview is the same duplication Task 37 removed from titles.
 */
const DEFAULT_TURN_SETTINGS: TurnSettings = {
  modelId: null,
  reasoningLevel: null,
  permission: DEFAULT_PERMISSION_MODE,
}

interface NewProjectInput {
  readonly name: string
  readonly icon: Project['icon']
  readonly description: string
  readonly folders: readonly { name: string; path: string }[]
}

/**
 * What creating a project hands back: the optimistic row, and the write's
 * verdict.
 *
 * `written` resolves to the harness's own refusal sentence, verbatim, when the
 * store refused the create - a folder that is not a directory, a volume root,
 * the same path twice - or to null once the write landed. A caller that closes
 * on the call itself rather than on this promise lands the person in a project
 * the harness is about to erase.
 */
interface CreatedProject {
  readonly project: Project
  readonly written: Promise<HarnessFailure | null>
}

/** How loading the index itself went. Distinct from any single record. */
export interface StorePhase {
  readonly status: 'loading' | 'ready' | 'no-harness' | 'failed'
  /** The refusal behind a failure, verbatim from the wire. */
  readonly error: HarnessFailure | null
}

/**
 * The model catalog, loaded beside the index and failing beside itself: a
 * catalog the harness will not serve must not blank the sidebar, and an index
 * that failed must not hide the picker's state behind the sidebar's error.
 */
export interface CatalogPhase {
  readonly status: 'loading' | 'ready' | 'no-harness' | 'failed'
  readonly error: HarnessFailure | null
}

export interface ModelCatalogState {
  readonly phase: CatalogPhase
  readonly connections: readonly ProviderConnection[]
  /** The picker's rows, mapped from the wire at the domain boundary. */
  readonly models: readonly CatalogModel[]
  /** The user's chosen defaults per slot; what the picker marks as default. */
  readonly defaults: DefaultSelection
}

const EMPTY_CATALOG: ModelCatalogState = {
  phase: { status: 'loading', error: null },
  connections: [],
  models: [],
  defaults: {},
}

function isReasoningLevel(value: string | null): value is ReasoningChoice {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  )
}

function mapRecord(record: ConversationRecordLike): Conversation {
  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    // The stream owns what was said. This list carries identity only.
    messages: [],
    updatedAt: record.lastTurnAt,
    pinned: record.pinned,
    archived: record.archived,
    modelId: record.modelId,
    // Rows written before the dial lost its Default step still carry
    // "default"; they read as absent and the harness rests them on medium.
    reasoningLevel: isReasoningLevel(record.reasoningLevel) ? record.reasoningLevel : null,
    // The wire vocabulary becomes the picker's here, once, at the store.
    permissionMode: executionModeFromWire(record.permissionMode),
  }
}

/** Exactly the fields this module maps, so no wire type leaks into context. */
interface ConversationRecordLike {
  readonly id: string
  readonly title: string | null
  readonly projectId: string | null
  readonly pinned: boolean
  readonly archived: boolean
  readonly lastTurnAt: number
  readonly modelId: string | null
  readonly reasoningLevel: string | null
  readonly permissionMode: ExecutionModeWire
}

function findIn(
  lists: readonly (readonly Conversation[])[],
  id: string,
): Conversation | undefined {
  for (const list of lists) {
    const found = list.find((conversation) => conversation.id === id)
    if (found !== undefined) return found
  }
  return undefined
}

interface WorkspaceValue {
  readonly projects: readonly Project[]
  readonly conversations: readonly Conversation[]
  readonly storePhase: StorePhase
  /** The model catalog the picker reads: harness-served rows, or a named state. */
  readonly catalog: ModelCatalogState
  readonly status: SessionStatus
  /**
   * Which conversations are working right now.
   *
   * A set rather than a flag: the sidebar answers "is anything happening in
   * the other three" without being one of them.
   */
  readonly running: ReadonlySet<string>
  /**
   * Marks a conversation working, or settled. Kept on the store rather than
   * derived, because the witnesses live in two places -- the phase machine of
   * an open conversation, and the demo turn's own callbacks -- and neither
   * should own the set both feed.
   */
  markRunning: (conversationId: string, active: boolean) => void
  readonly settings: TurnSettings

  setSettings: (settings: TurnSettings) => void
  /**
   * Settles the model and reasoning a conversation is held with, in the
   * index - so reopening restores the choice, and the admission path's own
   * write agrees with it.
   */
  setConversationSettings: (
    conversationId: string,
    settings: { readonly modelId: string | null; readonly reasoningLevel: ReasoningChoice | null },
  ) => void
  /**
   * Settles the execution mode a conversation is held with, in the index -
   * its own method rather than a fourth key on `setConversationSettings`,
   * because the mode is a consent with its own control and its own rate of
   * change. The window's settings follow, and the harness reads the stored
   * value at every permission decision, so a change lands on the very next
   * ask, including one a running turn raises.
   */
  setConversationPermission: (conversationId: string, permission: PermissionMode) => void
  /**
   * The permission questions the harness is holding: every row still waiting,
   * across conversations, each naming the conversation it belongs to. Bound
   * to the store's own client so a restart - which replaces the client - is
   * survived by the next call rather than by a captured object.
   */
  readonly approvals: {
    list: () => Promise<HarnessResult<readonly PendingApprovalRecord[]>>
    answer: (id: string, answer: ApprovalAnswer) => Promise<HarnessResult<void>>
    cancel: (id: string) => Promise<HarnessResult<void>>
  }
  /**
   * The questions the runs are asking for a decision - the ask-a-question
   * channel beside the approval one, same credential, different rows, and a
   * stop that ends a run's questions wholesale. Bound to the store's client
   * for the same restart reason `approvals` is.
   */
  readonly questions: {
    list: () => Promise<HarnessResult<readonly PendingQuestionRecord[]>>
    answer: (
      id: string,
      answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean },
    ) => Promise<HarnessResult<void>>
    cancel: (id: string) => Promise<HarnessResult<void>>
    stop: (conversationId: string) => Promise<HarnessResult<void>>
  }
  /**
   * The conversation plans the model writes and the person ticks. Read per
   * conversation - the plan belongs to the conversation, not to a run - and
   * carried with its damaged state, because an unreadable plan is a fact the
   * panel renders rather than a failure it swallows. Bound to the store's
   * client for the same restart reason `questions` is.
   */
  readonly plans: {
    get: (conversationId: string) => Promise<HarnessResult<PlanSnapshot>>
    tick: (
      conversationId: string,
      itemId: string,
      status: 'done' | 'pending',
    ) => Promise<HarnessResult<void>>
    clear: (conversationId: string) => Promise<HarnessResult<void>>
  }

  createProject: (input: NewProjectInput) => CreatedProject
  removeProject: (projectId: string) => void
  setBranch: (projectId: string, branch: string) => void

  /**
   * Records a conversation whose first turn the harness admitted.
   *
   * Runs after the receipt - creation is admission, so a refused first send
   * reaches nothing here. The local copy appears at once without a title and
   * is replaced by the stored record when the write lands; titling happens
   * once, in the harness, from the words actually sent.
   */
  beginConversation: (input: {
    readonly id: string
    readonly firstMessage: string
    readonly projectId: string | null
    readonly settings: {
      readonly modelId: string | null
      readonly reasoningLevel: ReasoningChoice | null
      readonly permission: PermissionMode
    }
    readonly title?: string
  }) => void
  /** Stamps recency after an admitted later turn. */
  touch: (conversationId: string) => void
  send: (conversationId: string | null, text: string) => string
  stop: () => void
  fork: (conversationId: string, messageId: string) => string | null

  rename: (conversationId: string, title: string) => void
  setProject: (conversationId: string, projectId: string | null) => void
  togglePin: (conversationId: string) => void
  setArchived: (conversationId: string, archived: boolean) => void
  /**
   * Permanent destruction of one conversation: journal, scoped rows, index
   * row, and tree. Resolves to the failure to show, or null when it is gone.
   * A running conversation is refused and stays exactly where it is.
   */
  remove: (conversationId: string) => Promise<HarnessFailure | null>
  /**
   * Permanent destruction over a selection or all of the archive. Resolves
   * to one sentence per conversation that did not fully purge, keyed by id -
   * an empty record means everything requested is gone. A request that never
   * completed reloads the list and resolves empty: the rows are back, which
   * is the honest signal.
   */
  removeMany: (
    conversationIds: readonly string[],
  ) => Promise<Readonly<Record<string, string>>>
  /**
   * Directory names under the conversations folder that no index row
   * addresses and no journal stream owns - trees earlier partial deletes
   * left behind. Read so the Archived pane can offer them; never swept by
   * the app.
   */
  readonly orphanTrees: readonly string[]
  /** Re-reads the orphan list. Best effort: a failure keeps the last answer. */
  refreshOrphanTrees: () => Promise<void>
  /**
   * Removes the orphaned trees, at the person's request. The failures record
   * holds one sentence per tree that could not be removed; empty means the
   * list is now empty.
   */
  sweepOrphanTrees: () => Promise<HarnessResult<Readonly<Record<string, string>>>>
  /**
   * Asks the supervisor to start the harness and re-reads when it does. The
   * remedy Task 34's notice names, reachable from anywhere that can see this
   * store's absence.
   */
  ensureStore: () => Promise<boolean>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // A detached window opens with the workspace its opening window saw, not
  // with an empty column while the harness answers. Read once for the life of
  // the window: it is a birth certificate, not a subscription.
  const [seed] = useState(() => (detachedConversationId() ? readHandoff() : null))

  const [remoteConversations, setRemoteConversations] = useState<readonly Conversation[]>(
    () =>
      (seed?.conversations ?? []).filter(
        (item) => item.id !== GALLERY_CONVERSATION_ID && item.messages.length === 0,
      ),
  )
  const [remoteProjects, setRemoteProjects] = useState<readonly Project[]>(
    () => seed?.projects ?? [],
  )
  const [localConversations, setLocalConversations] = useState<readonly Conversation[]>(() => [
    galleryConversation(),
    ...((seed?.conversations ?? []).filter((item) => item.messages.length > 0)),
  ])
  const [storePhase, setStorePhase] = useState<StorePhase>({ status: 'loading', error: null })
  const [catalog, setCatalog] = useState<ModelCatalogState>(EMPTY_CATALOG)
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set())

  // Mirrors `running` so the true-to-false transition - a turn actually
  // settling, not a page mounting on an idle conversation - is visible
  // outside the state updater. The transition is what arms the one re-read
  // that catches a harness-written title (see title-refresh).
  const runningWitnessRef = useRef<ReadonlySet<string>>(new Set())
  const titleRefreshRef = useRef<ReturnType<typeof createTitleRefresh> | null>(null)

  const markRunning = useCallback((conversationId: string, active: boolean) => {
    const was = runningWitnessRef.current.has(conversationId)
    if (was === active) return
    const next = new Set(runningWitnessRef.current)
    if (active) next.add(conversationId)
    else next.delete(conversationId)
    runningWitnessRef.current = next
    setRunning(next)
    // A conversation this window began has had its first exchange settle:
    // the harness's own titling may land in the next few seconds, and this
    // is the only moment the window will know to look.
    if (!active) titleRefreshRef.current?.settled(conversationId)
  }, [])

  const [settings, setSettingsState] = useState<TurnSettings>(DEFAULT_TURN_SETTINGS)

  /* ------------------------------ the index ------------------------------- */

  const clientRef = useRef<HarnessClient | null>(null)
  const liveRef = useRef(true)

  const load = useCallback(async () => {
    let client = clientRef.current
    if (client === null) {
      const address = await resolveHarnessAddress()
      if (!liveRef.current) return
      if (address === null) {
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

    if (!connections.ok) {
      setCatalog({
        phase: { status: 'failed', error: connections.error },
        connections: [],
        models: [],
        defaults: {},
      })
    } else if (!models.ok) {
      setCatalog((current) => ({
        ...current,
        phase: { status: 'failed', error: models.error },
        connections: connections.value,
      }))
    } else if (!defaults.ok) {
      setCatalog({
        phase: { status: 'failed', error: defaults.error },
        connections: connections.value,
        models: catalogFrom(connections.value, models.value),
        defaults: {},
      })
    } else {
      setCatalog({
        phase: { status: 'ready', error: null },
        connections: connections.value,
        models: catalogFrom(connections.value, models.value),
        defaults: defaults.value,
      })
    }

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
      current.filter(
        (item) => item.id === GALLERY_CONVERSATION_ID || !storedIds.has(item.id),
      ),
    )

    setRemoteConversations(conversations.value.map(mapRecord))
    setRemoteProjects(
      projects.value.map((project) => ({
        id: project.id,
        name: project.name,
        icon: project.icon,
        description: project.description,
        folders: project.folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          path: folder.path,
        })),
        // A checked-out branch is git's fact to report. Until some surface
        // reports it, there is none to show - which IdentityLine already
        // renders as "no branch control".
        branch: null,
        branches: [],
        createdAt: project.createdAt,
      })),
    )
    setStorePhase({ status: 'ready', error: null })
  }, [])

  // The harness names conversations on its own after their first exchange
  // settles (see title-refresh). This window witnesses that settlement only
  // through `markRunning`, so the one re-read that catches the new title is
  // armed here, once per conversation this window began.
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

  useEffect(() => {
    liveRef.current = true
    void load()
    return () => {
      liveRef.current = false
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
      if (signal.name === 'harness-starting' || signal.name === 'harness-started') {
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

  /** Offers to start the harness, and re-reads when it comes up. */
  const ensureStore = useCallback(async (): Promise<boolean> => {
    const cameUp = await startHarness()
    if (cameUp && liveRef.current) {
      clientRef.current = null
      setStorePhase({ status: 'loading', error: null })
      await load()
    }
    return cameUp
  }, [load])

  const setSettings = useCallback((next: TurnSettings) => {
    setSettingsState(next)
  }, [])

  /* --------------------------- optimistic writes -------------------------- */

  const patchAnyConversation = useCallback(
    (id: string, change: (conversation: Conversation) => Conversation) => {
      const apply = (
        current: readonly Conversation[],
      ): readonly Conversation[] =>
        current.map((conversation) =>
          conversation.id === id ? change(conversation) : conversation,
        )
      setRemoteConversations(apply)
      setLocalConversations(apply)
    },
    [],
  )

  const mutateIndex = useCallback(
    async (
      id: string,
      patch: Parameters<HarnessClient['updateConversation']>[1],
      localChange?: (conversation: Conversation) => Conversation,
    ) => {
      if (localChange !== undefined) patchAnyConversation(id, localChange)
      const client = clientRef.current
      if (client === null) return
      const result = await client.updateConversation(id, patch)
      // On any refusal the truth is re-read instead of locally reverted -
      // "what did not happen" has more cases than one revert can enumerate.
      if (!result.ok && liveRef.current) void load()
    },
    [load, patchAnyConversation],
  )

  /**
   * Settles the model and reasoning a conversation is held with, in the
   * index - so reopening restores the choice, and the admission path's own
   * write agrees with it. The window's settings follow the choice too, so the
   * composer's view and the row agree the moment the pick lands.
   */
  const setConversationSettings = useCallback(
    (
      conversationId: string,
      choice: { readonly modelId: string | null; readonly reasoningLevel: ReasoningChoice | null },
    ) => {
      setSettingsState((current) => ({ ...current, ...choice }))
      void mutateIndex(
        conversationId,
        { modelId: choice.modelId, reasoningLevel: choice.reasoningLevel },
        (conversation) => ({ ...conversation, ...choice }),
      )
    },
    [mutateIndex],
  )

  const setConversationPermission = useCallback(
    (conversationId: string, permission: PermissionMode) => {
      setSettingsState((current) => ({ ...current, permission }))
      // The wire value is translated here, at the one boundary the store
      // already owns; the picker's vocabulary never leaves the domain.
      void mutateIndex(
        conversationId,
        { permissionMode: executionModeToWire(permission) },
        (conversation) => ({ ...conversation, permissionMode: permission }),
      )
    },
    [mutateIndex],
  )

  /**
   * The approval surface, bound to the client the store already holds rather
   * than to an address, so a harness restart - which replaces the client -
   * is survived by the next call. With no client there is nothing to ask;
   * that is the same `not-reachable` failure every other call answers with.
   */
  const approvals = useMemo(
    () => ({
      list: () =>
        clientRef.current?.listPendingApprovals() ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so there is nothing to ask it.',
          },
        }),
      answer: (id: string, answer: ApprovalAnswer) =>
        clientRef.current?.answerApproval(id, answer) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the answer went nowhere.',
          },
        }),
      cancel: (id: string) =>
        clientRef.current?.cancelApproval(id) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the question could not be withdrawn.',
          },
        }),
    }),
    [],
  )

  const questions = useMemo(
    () => ({
      list: () =>
        clientRef.current?.listPendingQuestions() ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so there is nothing to ask it.',
          },
        }),
      answer: (
        id: string,
        answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean },
      ) =>
        clientRef.current?.answerQuestion(id, answer) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the answer went nowhere.',
          },
        }),
      cancel: (id: string) =>
        clientRef.current?.cancelQuestion(id) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the question could not be withdrawn.',
          },
        }),
      stop: (conversationId: string) =>
        clientRef.current?.stopQuestions(conversationId) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the questions could not be stopped.',
          },
        }),
    }),
    [],
  )

  const plans = useMemo(
    () => ({
      get: (conversationId: string) =>
        clientRef.current?.getPlan(conversationId) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so there is no plan to read.',
          },
        }),
      tick: (conversationId: string, itemId: string, status: 'done' | 'pending') =>
        clientRef.current?.tickPlanItem(conversationId, itemId, status) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the tick went nowhere.',
          },
        }),
      clear: (conversationId: string) =>
        clientRef.current?.clearPlan(conversationId) ??
        Promise.resolve({
          ok: false as const,
          error: {
            kind: 'not-reachable' as const,
            timedOut: false,
            message: 'The harness is not running, so the plan could not be cleared.',
          },
        }),
    }),
    [],
  )

  const beginConversation = useCallback(
    (input: {
      id: string
      firstMessage: string
      projectId: string | null
      settings: {
        readonly modelId: string | null
        readonly reasoningLevel: ReasoningChoice | null
        readonly permission: PermissionMode
      }
      /** A title the caller already knows - a fork's " (Fork)" name. Absent starts untitled. */
      title?: string
    }) => {
      // This window began the conversation, so its first exchange will
      // settle before a witness here, and the harness may still rename the
      // row afterwards: tracked, so the settlement arms the one re-read
      // that catches it.
      titleRefreshRef.current?.track(input.id)
      setRemoteConversations((current) => {
        // A second record under one receipt would be two sidebar rows pointing
        // at the same stream.
        if (current.some((conversation) => conversation.id === input.id)) return current
        return [
          {
            id: input.id,
            title: input.title ?? null,
            projectId: input.projectId,
            messages: [],
            updatedAt: Date.now(),
            pinned: false,
            archived: false,
            modelId: input.settings.modelId,
            reasoningLevel: input.settings.reasoningLevel,
            permissionMode: input.settings.permission,
          },
          ...current,
        ]
      })

      const client = clientRef.current
      if (client === null) return
      void client
        .createConversation({
          id: input.id,
          firstMessage: input.firstMessage,
          ...(input.projectId === null ? {} : { projectId: input.projectId }),
          modelId: input.settings.modelId,
          reasoningLevel: input.settings.reasoningLevel,
          permissionMode: executionModeToWire(input.settings.permission),
          createdAt: Date.now(),
        })
        .then(async (result) => {
          if (!liveRef.current) return
          if (!result.ok) {
            await load()
            return
          }
          const stored = mapRecord(result.value)
          setRemoteConversations((current) =>
            current.map((conversation) =>
              conversation.id === stored.id ? stored : conversation,
            ),
          )
        })
    },
    [load],
  )

  const touch = useCallback(
    (conversationId: string) => {
      void mutateIndex(
        conversationId,
        { lastTurnAt: Date.now() },
        (conversation) => ({ ...conversation, updatedAt: Date.now() }),
      )
    },
    [mutateIndex],
  )

  const rename = useCallback(
    (conversationId: string, title: string) => {
      const trimmed = title.trim()
      // An empty rename is a cancelled rename, not a request for a blank title.
      if (!trimmed) return
      void mutateIndex(
        conversationId,
        { title: trimmed },
        (conversation) => ({ ...conversation, title: trimmed }),
      )
    },
    [mutateIndex],
  )

  const setProject = useCallback(
    (conversationId: string, projectId: string | null) => {
      void mutateIndex(
        conversationId,
        { projectId },
        (conversation) => ({ ...conversation, projectId }),
      )
    },
    [mutateIndex],
  )

  const togglePin = useCallback(
    (conversationId: string) => {
      const current = findIn([remoteConversations, localConversations], conversationId)
      const pinned = !(current?.pinned ?? false)
      void mutateIndex(
        conversationId,
        { pinned },
        (conversation) => ({ ...conversation, pinned }),
      )
    },
    [localConversations, mutateIndex, remoteConversations],
  )

  const setArchived = useCallback(
    (conversationId: string, archived: boolean) => {
      void mutateIndex(
        conversationId,
        { archived },
        (conversation) => ({ ...conversation, archived }),
      )
    },
    [mutateIndex],
  )

  // Deleting removes the conversation everywhere it exists - the journal,
  // the scoped rows, the index row, and the tree - so the local copies leave
  // only once the harness says what actually went. A refusal (a turn in
  // flight) keeps the row; a partial destruction reloads, so the list shows
  // the truth rather than the request.
  const remove = useCallback(
    async (conversationId: string): Promise<HarnessFailure | null> => {
      const client = clientRef.current
      if (client === null) {
        return {
          kind: 'not-reachable',
          timedOut: false,
          message: 'The harness is not running, so the conversation was not deleted.',
        }
      }
      const result = await client.deleteConversation(conversationId)
      if (!liveRef.current) return result.ok ? null : result.error
      if (!result.ok) {
        void load()
        return result.error
      }
      const outcome = result.value
      if (outcome.removed.includes(conversationId)) {
        const doomed = conversationId
        setRemoteConversations((current) => current.filter((item) => item.id !== doomed))
        setLocalConversations((current) => current.filter((item) => item.id !== doomed))
        return null
      }
      await load()
      const detail = outcome.details[conversationId]
      const message = detail?.error ?? 'The conversation could not be deleted.'
      return {
        kind: 'harness-error',
        status: detail?.errorCode === 'storage.conflict' ? 409 : 500,
        message,
        ...(detail?.errorCode === undefined ? {} : { code: detail.errorCode }),
      }
    },
    [load],
  )

  const removeMany = useCallback(
    async (conversationIds: readonly string[]): Promise<Readonly<Record<string, string>>> => {
      const doomed = new Set(conversationIds)
      setRemoteConversations((current) => current.filter((item) => !doomed.has(item.id)))
      const client = clientRef.current
      if (client === null || doomed.size === 0) return {}
      const result = await client.purgeConversations([...doomed])
      if (!liveRef.current) return {}
      if (!result.ok) {
        await load()
        return {}
      }
      // Rows the purge refused or only half-destroyed are back after the
      // reload; the per-id sentences say which ones and why.
      if ([...doomed].some((id) => !result.value.removed.includes(id))) await load()
      return result.value.cleanupFailures
    },
    [load],
  )

  const [orphanTrees, setOrphanTrees] = useState<readonly string[]>([])

  const refreshOrphanTrees = useCallback(async (): Promise<void> => {
    const client = clientRef.current
    if (client === null) return
    const result = await client.listOrphanTrees()
    if (!liveRef.current || !result.ok) return
    setOrphanTrees(result.value.orphans)
  }, [])

  const sweepOrphanTrees = useCallback(async (): Promise<
    HarnessResult<Readonly<Record<string, string>>>
  > => {
    const client = clientRef.current
    if (client === null) {
      return {
        ok: false,
        error: {
          kind: 'not-reachable',
          timedOut: false,
          message: 'The harness is not running, so the leftover folders were not removed.',
        },
      }
    }
    const result = await client.sweepOrphanTrees()
    if (!result.ok) return result
    if (!liveRef.current) return { ok: true, value: {} }
    await refreshOrphanTrees()
    return { ok: true, value: result.value.failures }
  }, [refreshOrphanTrees])

  /* ------------------------------ projects -------------------------------- */

  const createProject = useCallback((input: NewProjectInput): CreatedProject => {
    const created: Project = {
      id: newId('prj'),
      name: input.name.trim(),
      icon: input.icon,
      description: input.description.trim(),
      folders: input.folders.map((folder) => ({ id: newId('src'), ...folder })),
      branch: input.folders.length > 0 ? 'main' : null,
      branches: input.folders.length > 0 ? ['main'] : [],
      createdAt: Date.now(),
    }
    setRemoteProjects((current) => [...current, created])

    const client = clientRef.current
    if (client === null) {
      return { project: created, written: Promise.resolve(null) }
    }

    const request = client.createProject({
      id: created.id,
      name: created.name,
      icon: created.icon,
      ...(created.description === '' ? {} : { description: created.description }),
      folders: created.folders.map((folder) => ({
        name: folder.name,
        path: folder.path,
      })),
    })
    // The row's truth, unchanged: server-minted folder ids are adopted when
    // the write lands, and a refusal reloads, which is what drops the
    // optimistic row. The dialog reads the same promise through `written`,
    // for the verdict that decides whether it closes at all.
    void request.then(async (result) => {
      if (!liveRef.current) return
      if (!result.ok) {
        await load()
        return
      }
      const stored = result.value
      setRemoteProjects((current) =>
        current.map((project) =>
          project.id === stored.id
            ? {
                ...project,
                folders: stored.folders.map((folder) => ({
                  id: folder.id,
                  name: folder.name,
                  path: folder.path,
                })),
              }
            : project,
        ),
      )
    })
    return {
      project: created,
      written: request.then((result) => (result.ok ? null : result.error)),
    }
  }, [load])

  const removeProject = useCallback(
    (projectId: string) => {
      // Detaches its conversations rather than deleting them - SET NULL at
      // the schema, the same meaning everywhere above it.
      setRemoteProjects((current) =>
        current.filter((project) => project.id !== projectId),
      )
      setRemoteConversations((current) =>
        current.map((conversation) =>
          conversation.projectId === projectId
            ? { ...conversation, projectId: null }
            : conversation,
        ),
      )
      const client = clientRef.current
      if (client === null) return
      void client.deleteProject(projectId).then(async (result) => {
        if (liveRef.current && !result.ok) await load()
      })
    },
    [load],
  )

  const setBranch = useCallback((projectId: string, branch: string) => {
    // Memory only: branches are git's fact to report, and nothing here stores
    // them.
    setRemoteProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, branch } : project)),
    )
  }, [])

  /* --------------------- the demo path (gallery only) --------------------- */

  const findConversation = useCallback(
    (conversationId: string): Conversation | undefined =>
      findIn([remoteConversations, localConversations], conversationId),
    [localConversations, remoteConversations],
  )

  const turns = useDemoTurns({
    status: setStatus,
    modelId: useCallback(() => settings.modelId, [settings.modelId]),
    markRunning,
    findConversation,
    upsertLocal: setLocalConversations,
  })
  const cancel = useCallback(() => {
    turns.cancel()
    // The method, not the object: `turns` is rebuilt every render and only
    // `cancel` is called through this callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.cancel])

  const stop = useCallback(() => {
    cancel()
    setStatus('idle')
  }, [cancel])

  /* -------------------------------- value --------------------------------- */

  const conversations = useMemo(
    () => [...localConversations, ...remoteConversations],
    [localConversations, remoteConversations],
  )

  const value = useMemo<WorkspaceValue>(
    () => ({
      projects: remoteProjects,
      conversations,
      storePhase,
      catalog,
      status,
      running,
      markRunning,
      settings,
      setSettings,
      setConversationSettings,
      setConversationPermission,
      approvals,
      questions,
      plans,
      createProject,
      removeProject,
      setBranch,
      beginConversation,
      touch,
      send: turns.send,
      stop,
      fork: turns.fork,
      rename,
      setProject,
      togglePin,
      setArchived,
      remove,
      removeMany,
      orphanTrees,
      refreshOrphanTrees,
      sweepOrphanTrees,
      ensureStore,
    }),
    [
      approvals,
      beginConversation,
      catalog,
      conversations,
      createProject,
      ensureStore,
      markRunning,
      orphanTrees,
      plans,
      questions,
      refreshOrphanTrees,
      sweepOrphanTrees,
      remoteProjects,
      remove,
      removeMany,
      removeProject,
      rename,
      running,
      setArchived,
      setBranch,
      setConversationSettings,
      setConversationPermission,
      setProject,
      setSettings,
      status,
      stop,
      storePhase,
      settings,
      touch,
      togglePin,
      turns.fork,
      turns.send,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}
