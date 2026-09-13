/**
 * The conversation index: the rows the sidebar lists, the drafts and patches
 * that change them, and what a purge reports back.
 */

import { isRecord } from '@/lib/guards'
import { EXECUTION_MODES, type ExecutionModeWire, REASONING_CHOICES, type ReasoningChoice } from './picklists'
import { finiteNumber, flag, listOf, nullableText, oneOf, text } from './guards'

/*
 * Mirrored from `STUDIO HARNESS/src/contracts/conversations.ts`. This is the
 * INDEX, not a transcript: identity, title, filing and flags, and never one
 * word of what was said. Flue's stream at `agents/studio/<id>` owns the words,
 * and reading them back is `useConversation`'s job above.
 *
 * Like every contract here these are wire types; the sidebar's `Conversation`
 * lives in `domain/conversation/types.ts` and mapping happens once at the store.
 */

export interface ConversationRecord {
  readonly id: string
  readonly title: string | null
  readonly projectId: string | null
  /** A person named this; automatic titling has stopped for it. */
  readonly titleManual: boolean
  readonly pinned: boolean
  readonly archived: boolean
  /** Which model the conversation is held with, in the runtime's own vocabulary; null for the default alias. */
  readonly modelId: string | null
  /** The reasoning choice it is held with; null is the same state as "default". */
  readonly reasoningLevel: ReasoningChoice | null
  /**
   * The execution mode the conversation is held with, in the harness's own
   * vocabulary. Never null on the wire: the absence of a stored answer IS
   * Manual, and the store resolves that before the record leaves
   * (`STUDIO HARNESS/src/conversations/store.ts`), so a fourth "unset" state
   * cannot reach this side and be guessed at.
   */
  readonly permissionMode: ExecutionModeWire
  readonly createdAt: number
  readonly lastTurnAt: number
}

export function nullableChoice(
  value: unknown,
): { ok: true; value: ReasoningChoice | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  const parsed = oneOf(REASONING_CHOICES, value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

export function parseConversationRecord(value: unknown): ConversationRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const title = nullableText(value['title'])
  const projectId = nullableText(value['projectId'])
  const titleManual = flag(value['titleManual'])
  const pinned = flag(value['pinned'])
  const archived = flag(value['archived'])
  const modelId = nullableText(value['modelId'])
  const reasoningLevel = nullableChoice(value['reasoningLevel'])
  const permissionMode = oneOf(EXECUTION_MODES, value['permissionMode'])
  const createdAt = finiteNumber(value['createdAt'])
  const lastTurnAt = finiteNumber(value['lastTurnAt'])

  if (
    id === null ||
    !title.ok ||
    !projectId.ok ||
    titleManual === null ||
    pinned === null ||
    archived === null ||
    !modelId.ok ||
    !reasoningLevel.ok ||
    permissionMode === null ||
    createdAt === null ||
    lastTurnAt === null
  ) {
    return null
  }

  // Field by field, like every other record here: nothing un-named in a
  // response body can reach the sidebar through this parser.
  return {
    id,
    title: title.value,
    projectId: projectId.value,
    titleManual,
    pinned,
    archived,
    modelId: modelId.value,
    reasoningLevel: reasoningLevel.value,
    permissionMode,
    createdAt,
    lastTurnAt,
  }
}

export function parseConversationRecords(value: unknown): readonly ConversationRecord[] | null {
  return listOf(parseConversationRecord, value)
}

/** What creating an index row sends: identity plus the words the title comes from. */
export interface ConversationCreateDraft {
  readonly id: string
  readonly firstMessage: string
  readonly projectId?: string | null
  /** The settings the first turn is being sent with, when one is settled. */
  readonly modelId?: string | null
  readonly reasoningLevel?: ReasoningChoice | null
  /** The mode the first turn was admitted under, in the wire vocabulary. */
  readonly permissionMode?: ExecutionModeWire
  /** The moment the admission receipt arrived; defaults to the harness's clock. */
  readonly createdAt?: number
}

/**
 * What a rename, pin, archive, filing change, or later-turn stamp changes.
 * Absent keys are left alone; `projectId: null` clears the filing, and
 * `modelId: null` clears the model back to the default alias. `permissionMode`
 * is never null: a mode is a consent, and there is no "unset" state to clear
 * back to - the bottom of the ladder is Manual, which is a real answer.
 */
export interface ConversationPatch {
  readonly title?: string
  readonly pinned?: boolean
  readonly archived?: boolean
  readonly projectId?: string | null
  readonly modelId?: string | null
  readonly reasoningLevel?: ReasoningChoice | null
  readonly permissionMode?: ExecutionModeWire
  readonly lastTurnAt?: number
}

/**
 * The answer to permanent destruction over one id or many. `removed` holds
 * only ids that are fully gone - journal, scoped rows, index row, and tree.
 * Anything less is not called removed: `cleanupFailures` carries one
 * sentence per id that did not fully purge, and `details` says per id what
 * was destroyed and what was not, so a partial failure is legible instead
 * of being flattened into "removed".
 */
export interface PurgeDetail {
  readonly indexRow: boolean
  readonly tree: boolean
  readonly journal: boolean
  readonly scoped: boolean
  readonly errorCode?: string
  readonly error?: string
}

export interface PurgeOutcome {
  readonly removed: readonly string[]
  readonly cleanupFailures: Readonly<Record<string, string>>
  readonly details: Readonly<Record<string, PurgeDetail>>
}

export function parsePurgeDetail(value: unknown): PurgeDetail | null {
  if (!isRecord(value)) return null
  const indexRow = flag(value['indexRow'])
  const tree = flag(value['tree'])
  const journal = flag(value['journal'])
  const scoped = flag(value['scoped'])
  if (indexRow === null || tree === null || journal === null || scoped === null) return null
  const errorCode = value['errorCode']
  const error = value['error']
  if (errorCode !== undefined && typeof errorCode !== 'string') return null
  if (error !== undefined && typeof error !== 'string') return null
  return {
    indexRow,
    tree,
    journal,
    scoped,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(error === undefined ? {} : { error }),
  }
}

export function parsePurgeOutcome(value: unknown): PurgeOutcome | null {
  if (!isRecord(value)) return null
  const removed = listOf(parseId, value['removed'])
  if (!isRecord(value['cleanupFailures']) || !isRecord(value['details']) || removed === null)
    return null

  const failures: Record<string, string> = {}
  for (const [key, message] of Object.entries(value['cleanupFailures'])) {
    if (typeof message !== 'string') return null
    failures[key] = message
  }
  const details: Record<string, PurgeDetail> = {}
  for (const [key, detail] of Object.entries(value['details'])) {
    const parsed = parsePurgeDetail(detail)
    if (parsed === null) return null
    details[key] = parsed
  }
  return { removed, cleanupFailures: failures, details }
}

/** Trees no index row addresses, listed for a person's sweep - never swept by the app. */
export interface OrphanTrees {
  readonly orphans: readonly string[]
}

export function parseOrphanTrees(value: unknown): OrphanTrees | null {
  if (!isRecord(value)) return null
  const orphans = listOf(parseId, value['orphans'])
  if (orphans === null) return null
  return { orphans }
}

/** What a person's orphan sweep removed, and what it could not. */
export interface OrphanSweepOutcome {
  readonly removed: readonly string[]
  readonly failures: Readonly<Record<string, string>>
}

export function parseOrphanSweepOutcome(value: unknown): OrphanSweepOutcome | null {
  if (!isRecord(value)) return null
  const removed = listOf(parseId, value['removed'])
  if (!isRecord(value['failures']) || removed === null) return null
  const failures: Record<string, string> = {}
  for (const [key, message] of Object.entries(value['failures'])) {
    if (typeof message !== 'string') return null
    failures[key] = message
  }
  return { removed, failures }
}

export function parseId(value: unknown): string | null {
  return text(value)
}
