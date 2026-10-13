import type { CatalogModel } from '@/domain/models/catalog'
import type { ReasoningChoice } from '@/domain/models/types'
import type { PermissionMode } from '@/domain/permissions/modes'
import type { Conversation, TurnSettings } from '@/domain/conversation/types'
import type { Project } from '@/domain/projects/types'
import type {
  ApprovalAnswer,
  DefaultSelection,
  FolderListing,
  HarnessFailure,
  HarnessResult,
  PendingApprovalRecord,
  PendingQuestionRecord,
  PlanSnapshot,
  BackgroundJob,
  AgentTask,
  AgentRosterRecord,
  MediaJob,
  MediaArtifactFile,
  ProviderConnection,
} from '@/platform/harness'

/**
 * What the workspace store publishes, and nothing about how it is built.
 *
 * The shapes are here on their own so the pieces that assemble the store -
 * the harness sync, the bound client, the writes - can each name the part
 * they produce without importing the provider that composes them.
 */

export interface NewProjectInput {
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
export interface CreatedProject {
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

/**
 * The harness surfaces the store hands out bound to its own client rather
 * than to an address, so a harness restart - which replaces the client - is
 * survived by the next call rather than by a captured object. With no client
 * there is nothing to ask; that is the same `not-reachable` failure every
 * other call answers with.
 */
export interface BoundClient {
  /**
   * The permission questions the harness is holding: every row still waiting,
   * across conversations, each naming the conversation it belongs to.
   */
  readonly approvals: {
    list: () => Promise<HarnessResult<readonly PendingApprovalRecord[]>>
    answer: (id: string, answer: ApprovalAnswer) => Promise<HarnessResult<void>>
    cancel: (id: string) => Promise<HarnessResult<void>>
  }
  /**
   * The questions the runs are asking for a decision - the ask-a-question
   * channel beside the approval one, same credential, different rows, and a
   * stop that ends a run's questions wholesale.
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
   * panel renders rather than a failure it swallows.
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
  /** The background commands a conversation started, and the person's stop. */
  readonly backgroundJobs: {
    list: (conversationId: string) => Promise<HarnessResult<readonly BackgroundJob[]>>
    stop: (conversationId: string, jobId: string) => Promise<HarnessResult<BackgroundJob | null>>
  }
  /** The harness's dispatched agent tasks, bound like the commands. */
  readonly tasks: {
    list: () => Promise<HarnessResult<readonly AgentTask[]>>
    cancel: (taskId: string) => Promise<HarnessResult<boolean>>
  }
  /**
   * The harness's agent roster, read-only. Definitions are code on the
   * harness side; this surface exists so the Settings pane can show what
   * actually runs, not so anything can edit it.
   */
  readonly agents: {
    list: () => Promise<HarnessResult<readonly AgentRosterRecord[]>>
  }
  /** The person's stop for a conversation's browser (ADR 0049 §4). */
  readonly browser: {
    stop: (conversationId: string) => Promise<HarnessResult<boolean>>
  }
  /** The person's stop for a conversation's computer control (ADR 0055 §7). */
  readonly computer: {
    stop: (conversationId: string) => Promise<HarnessResult<boolean>>
  }
  /** The generation jobs - images and videos - bound the same way. */
  readonly mediaJobs: {
    list: (conversationId: string) => Promise<HarnessResult<readonly MediaJob[]>>
    stop: (conversationId: string, jobId: string) => Promise<HarnessResult<void>>
    /**
     * The finished generations the conversation's artifacts directory still
     * answers - the record that survives a restart, when `list` no longer
     * knows the job that produced the files.
     */
    artifacts: (conversationId: string) => Promise<HarnessResult<readonly MediaArtifactFile[]>>
  }
  /**
   * One directory of the PC, listed by the harness, for the folder picker a
   * browser tab needs (plan step 6). Answered as a not-reachable failure when
   * there is no client, so the picker renders the sentence rather than
   * throwing.
   */
  browseFolders: (path?: string) => Promise<HarnessResult<FolderListing>>
}

/** The writes that change which conversations exist and how they are held. */
export interface ConversationWrites {
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
  /**
   * Records a fork the harness already created.
   *
   * Unlike `beginConversation` there is no receipt and no POST: the row,
   * the transcript and the title already exist server-side under the id.
   * The local row appears at once with the fork's title and is replaced by
   * the stored record when the re-read lands. No title tracking - the fork
   * is named and manual from birth, so no rename is coming.
   */
  adoptConversation: (input: {
    readonly id: string
    readonly projectId: string | null
    readonly settings: {
      readonly modelId: string | null
      readonly reasoningLevel: ReasoningChoice | null
      readonly permission: PermissionMode
    }
    readonly title: string
  }) => void
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
}

/** The writes that change which projects exist and what they hold. */
export interface ProjectWrites {
  createProject: (input: NewProjectInput) => CreatedProject
  /**
   * Records that the person vouches for these folders.
   *
   * Separate from creating the project because the harness decides trust per
   * folder rather than per project: two projects attaching the same
   * repository share the one answer, and a folder keeps it when a project
   * lets it go. Resolves to the first refusal, or null when every folder was
   * written.
   */
  trustFolders: (paths: readonly string[]) => Promise<HarnessFailure | null>
  removeProject: (projectId: string) => void
  setBranch: (projectId: string, branch: string) => void
}

export interface WorkspaceValue extends BoundClient, ConversationWrites, ProjectWrites {
  readonly projects: readonly Project[]
  readonly conversations: readonly Conversation[]
  readonly storePhase: StorePhase
  /** The model catalog the picker reads: harness-served rows, or a named state. */
  readonly catalog: ModelCatalogState
  readonly settings: TurnSettings
  setSettings: (settings: TurnSettings) => void
  /**
   * Asks the supervisor to start the harness and re-reads when it does. The
   * remedy Task 34's notice names, reachable from anywhere that can see this
   * store's absence.
   */
  ensureStore: () => Promise<boolean>
}
