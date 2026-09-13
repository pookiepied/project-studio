/**
 * The conversation content wire contract, mirrored by hand.
 *
 * Task 24's `contracts.ts` carried chunk FACTS only — type, position, ids,
 * outcome — because nothing rendered yet. Rendering needs what the chunks
 * SAY, and the history snapshot too, so the mirror lives here now, beside the
 * facts it extends. Source of truth:
 * `STUDIO HARNESS/node_modules/@flue/runtime/dist/internal.d.mts`
 * (`ConversationStreamChunk`, `AgentConversationSnapshot`), observed on a live
 * harness while writing this. Like every mirror: when the harness contract
 * changes, nothing in either build will tell you. Update it in the same change.
 *
 * Two shapes meet here, and they are the same shapes on purpose:
 *
 * - The `updates` view's chunks, which describe operations (a delta arrived, a
 *   tool call was made).
 * - The `history` view's snapshot — and the `conversation-reset` chunk, which
 *   carries the identical snapshot object — which describes STATE. Seeding a
 *   projection from history and replacing one from a reset chunk is the same
 *   operation for exactly this reason.
 *
 * An unknown chunk type survives as a fact carrying only its position.
 * Dropping it would desync position dedupe: the next batch's chunks would be
 * judged against an applied marker that never advanced past what this client
 * actually saw. A fact with no payload loses nothing that can be rendered and
 * costs nothing to keep.
 */

/* -------------------------------------------------------------------------- */
/* Primitive guards                                                            */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty string, which is what every `minLength(1)` on the harness means. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Membership as a narrowing, without a cast; see `contracts.ts`. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  for (const item of allowed) if (item === value) return item
  return null
}

/* -------------------------------------------------------------------------- */
/* Positions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The monotonic ordering token stamped on every projected chunk,
 * lexicographic by batch then index. It exists so a redelivered batch — an
 * SSE reconnect replays the batch that was in flight — can be dropped
 * instead of double-applied. Like offsets: opaque, never interpreted.
 */
export interface ChunkPosition {
  readonly batch: number
  readonly index: number
}

function readChunkPosition(value: unknown): ChunkPosition | null {
  if (!isRecord(value)) return null
  const batch = finiteNumber(value['batch'])
  const index = finiteNumber(value['index'])
  return batch === null || index === null ? null : { batch, index }
}

/* -------------------------------------------------------------------------- */
/* Messages, parts, usage                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Which side of the conversation a message is on.
 *
 * `system` is 2.0's channel for runtime advisories - the terminal marker an
 * aborted or interrupted submission records ("Submission was aborted."), and
 * the recovery signals around a materialized partial stream. Measured on a
 * live 2.0 harness: an aborted turn's history carries user, the empty
 * assistant attempt, then a system message whose `settlement` names the
 * outcome. A snapshot containing one is REJECTED unless the reader accepts
 * the role, which is why the role is mirrored rather than filtered upstream:
 * one stop control press must not make a conversation's history unreadable.
 * The transcript does not render these; see `seededFrom`.
 */
type MessageRole = 'user' | 'assistant' | 'system'

/** How far a projected text or reasoning part had got when the snapshot was taken. */
type PartState = 'streaming' | 'done'

/**
 * One materialized part of a message. `text` and `reasoning` arrive complete
 * here (history and resets project state, not deltas); their `state` says
 * whether the message was still being written — the snapshot's own word for
 * "this turn never finished", which rendering must honour rather than infer
 * from silence. A tool part carries its call and whatever answer exists for
 * it at projection time.
 */
type MessagePartFacts =
  | { readonly kind: 'text'; readonly text: string; readonly state: PartState }
  | { readonly kind: 'reasoning'; readonly text: string; readonly state: PartState }
  | {
      readonly kind: 'file'
      readonly mediaType: string
      readonly id: string | null
      readonly size: number | null
      readonly url: string | null
      readonly filename: string | null
    }
  | {
      readonly kind: 'tool'
      readonly toolCallId: string
      readonly toolName: string
      /** How far the call got before this projection was taken. */
      readonly state: 'input-available' | 'output-available' | 'output-error'
      readonly input: { readonly present: boolean; readonly value: unknown }
      readonly output: { readonly present: boolean; readonly value: unknown }
      readonly errorText: string | null
    }

export interface UsageFacts {
  readonly input: number | null
  readonly output: number | null
  readonly cacheRead: number | null
  readonly cacheWrite: number | null
  readonly reasoning: number | null
  readonly totalTokens: number | null
}

/** Which provider and model produced a message, exactly as the wire names them. */
export interface ModelRefFacts {
  readonly provider: string
  readonly id: string
}

export interface ConversationMessageFacts {
  readonly id: string
  readonly role: MessageRole
  /** The submission this message belongs to; absent on messages without one. */
  readonly submissionId: string | null
  readonly parts: readonly MessagePartFacts[]
  readonly timestamp: string | null
  readonly model: ModelRefFacts | null
  readonly usage: UsageFacts | null
}

/** How one submission ended, per the settlement records. */
interface SettlementFacts {
  readonly submissionId: string
  readonly outcome: 'completed' | 'failed' | 'aborted'
  readonly result: { readonly present: boolean; readonly value: unknown }
  /**
   * What the harness said went wrong, parsed. A failure the wire carried no
   * error object for reads as `present: false` — still a failure, just one
   * with no sentence to show. An error object this side cannot read (not a
   * record) is `present: true` with every field null, for the same reason:
   * "there was a reason, and it is unknown" is a different fact from "there
   * was no reason".
   */
  readonly error: SettlementErrorFacts
}

/**
 * The error object of a failed or aborted settlement, mirrored field by
 * field from what Flue actually serializes (`serializeError` in
 * `@flue/runtime`, observed on a live harness):
 *
 * `{"name":"FlueError","type":"operation_failed","message":"direct(...)
 * failed: 429 rate limit exceeded: ...","details":""}`
 *
 * The provider's own sentence lives in `message`; that is the part a person
 * can act on, and dropping it is how Task 25 turned a faithful log into a
 * fabricated success. `details` also exists on the wire but was empty in
 * every capture; it stays unmirrored until something needs it.
 */
interface SettlementErrorFacts {
  /** Whether the wire carried an error object at all. */
  readonly present: boolean
  /** The error class name — "FlueError", "FlueHttpError". */
  readonly name: string | null
  /** Flue's stable error type — "operation_failed", not the message. */
  readonly type: string | null
  /** The sentence a person could act on. Never synthesised when absent. */
  readonly message: string | null
}

const NO_SETTLEMENT_ERROR: SettlementErrorFacts = {
  present: false,
  name: null,
  type: null,
  message: null,
}

function readSettlementError(value: unknown): SettlementErrorFacts {
  if (value === undefined) return NO_SETTLEMENT_ERROR
  if (!isRecord(value)) return { present: true, name: null, type: null, message: null }
  return {
    present: true,
    name: text(value['name']),
    type: text(value['type']),
    message: text(value['message']),
  }
}

/**
 * `AgentConversationSnapshot`: the materialized conversation at a durable
 * offset. `offset` is the physical stream tail INCLUDING records this
 * conversation's projection omits — the offset to resume updates from, not a
 * count of anything.
 */
export interface ConversationSnapshotFacts {
  readonly version: number
  readonly conversationId: string | null
  readonly offset: string | null
  readonly messages: readonly ConversationMessageFacts[]
  readonly settlements: readonly SettlementFacts[]
}

/**
 * A field the wire may omit. `present` is load-bearing: an explicit `null`
 * result and an absent result are different facts, and collapsing both into
 * `null` would let a settlement that said nothing be read as one that said no.
 */
export interface Present<T> {
  readonly present: boolean
  readonly value: T | undefined
}

function absent(): Present<never> {
  return { present: false, value: undefined }
}

export function present<T>(value: T): Present<T> {
  return { present: true, value }
}

/* -------------------------------------------------------------------------- */
/* Part, message, snapshot readers                                             */
/* -------------------------------------------------------------------------- */

function readPresentJson(value: unknown): Present<unknown> {
  return value === undefined ? absent() : present(value)
}

function readUsage(value: unknown): UsageFacts | null {
  if (!isRecord(value)) return null
  const read = (key: string): number | null => finiteNumber(value[key])
  return {
    input: read('input'),
    output: read('output'),
    cacheRead: read('cacheRead'),
    cacheWrite: read('cacheWrite'),
    reasoning: read('reasoning'),
    totalTokens: read('totalTokens'),
  }
}

function readModelRef(value: unknown): ModelRefFacts | null {
  if (!isRecord(value)) return null
  const provider = text(value['provider'])
  const id = text(value['id'])
  return provider === null || id === null ? null : { provider, id }
}

function readFilePart(value: unknown): MessagePartFacts | null {
  if (!isRecord(value)) return null
  const mediaType = text(value['mediaType'])
  if (mediaType === null) return null
  const id = optionalText(value['id'])
  const url = optionalText(value['url'])
  const filename = optionalText(value['filename'])
  if (!id.ok || !url.ok || !filename.ok) return null
  return {
    kind: 'file',
    mediaType,
    id: id.value ?? null,
    size: finiteNumber(value['size']),
    url: url.value ?? null,
    filename: filename.value ?? null,
  }
}

function optionalText(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined) return { ok: true }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

const TOOL_PART_STATES = ['input-available', 'output-available', 'output-error'] as const

function readToolPart(value: unknown): MessagePartFacts | null {
  if (!isRecord(value)) return null
  const toolCallId = text(value['toolCallId'])
  const toolName = text(value['toolName'])
  const state = oneOf(TOOL_PART_STATES, value['state'])
  if (toolCallId === null || toolName === null || state === null) return null
  return {
    kind: 'tool',
    toolCallId,
    toolName,
    state,
    input: readPresentJson(value['input']),
    output: readPresentJson(value['output']),
    errorText: text(value['errorText']),
  }
}

const PART_STATES = ['streaming', 'done'] as const

function readMessagePart(value: unknown): MessagePartFacts | null {
  if (!isRecord(value)) return null
  switch (value['type']) {
    case 'text':
    case 'reasoning': {
      // An empty part body is legal; a missing one is not.
      if (typeof value['text'] !== 'string') return null
      const state = oneOf(PART_STATES, value['state'])
      if (state === null) return null
      return value['type'] === 'text'
        ? { kind: 'text', text: value['text'], state }
        : { kind: 'reasoning', text: value['text'], state }
    }
    case 'file':
      return readFilePart(value)
    case 'dynamic-tool':
      return readToolPart(value)
    default:
      return null
  }
}

function readParts(value: unknown): readonly MessagePartFacts[] | null {
  if (!Array.isArray(value)) return null
  const parts: MessagePartFacts[] = []
  for (const item of value) {
    const part = readMessagePart(item)
    if (part === null) return null
    parts.push(part)
  }
  return parts
}

function readConversationMessage(value: unknown): ConversationMessageFacts | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const role = oneOf(['user', 'assistant', 'system'] as const, value['role'])
  const parts = readParts(value['parts'])
  if (id === null || role === null || parts === null) return null

  // 2.0 stamps nothing into message metadata: whatever is there is
  // agent-authored, and no Studio agent attaches any. `model`, `timestamp`
  // and `usage` therefore read null on every 2.0 record - 1.0's
  // `metadata.model` and friends are gone from the wire entirely.
  const metadata = isRecord(value['metadata']) ? value['metadata'] : {}
  return {
    id,
    role,
    submissionId: text(value['submissionId']),
    parts,
    timestamp: text(metadata['timestamp']),
    model: readModelRef(metadata['model']),
    usage: readUsage(metadata['usage']),
  }
}

function readSettlement(value: unknown): SettlementFacts | null {
  if (!isRecord(value)) return null
  const submissionId = text(value['submissionId'])
  const outcome = oneOf(['completed', 'failed', 'aborted'] as const, value['outcome'])
  if (submissionId === null || outcome === null) return null
  return {
    submissionId,
    outcome,
    result: readPresentJson(value['result']),
    error: readSettlementError(value['error']),
  }
}

/**
 * Reads the history view's body, or a reset chunk's embedded snapshot.
 * Strict on purpose: a snapshot is a cold start's whole source of truth, so a
 * body that cannot be fully trusted must fail loudly enough for the caller to
 * show why, not silently render half a conversation.
 */
export function readConversationSnapshot(value: unknown): ConversationSnapshotFacts | null {
  if (!isRecord(value)) return null
  const version = finiteNumber(value['v'])
  if (!Array.isArray(value['messages']) || !Array.isArray(value['settlements'])) return null

  const messages: ConversationMessageFacts[] = []
  for (const item of value['messages']) {
    const message = readConversationMessage(item)
    if (message === null) return null
    messages.push(message)
  }
  const settlements: SettlementFacts[] = []
  for (const item of value['settlements']) {
    const settlement = readSettlement(item)
    if (settlement === null) return null
    settlements.push(settlement)
  }

  return {
    version: version ?? 0,
    conversationId: text(value['conversationId']),
    offset: text(value['offset']),
    messages,
    settlements,
  }
}

/* -------------------------------------------------------------------------- */
/* Chunk facts                                                                 */
/* -------------------------------------------------------------------------- */

/** How a settled turn ended; absent on everything else. */
type TurnOutcome = 'completed' | 'failed' | 'aborted'

/**
 * What one projected chunk says, mirrored from `ConversationStreamChunk`.
 *
 * One flat record with `null` for every field the wire omitted — the same
 * shape Task 24 mirrored before rendering existed, extended with the fields
 * content needs. An unrecognised chunk type comes back carrying only its
 * identity fields, which is deliberate: dropping an unknown chunk would
 * desync position dedupe, and its type name plus position are the two facts
 * every consumer can agree on without understanding it.
 */
export interface ChunkFacts {
  readonly type: string
  readonly position: ChunkPosition | null

  /* ---- Identity facts, shared by every message-bearing chunk ------------- */

  /** `message-started`, `message-appended` (via its message), deltas, tool inputs. */
  readonly messageId: string | null
  /** `message-started` names the submission generating the message. */
  readonly submissionId: string | null
  /** `submission-settled`: how a turn ended. */
  readonly outcome: TurnOutcome | null

  /* ---- Content payloads, one family per chunk type ----------------------- */

  /** `conversation-reset`: replace all local content with this state. */
  readonly snapshot: ConversationSnapshotFacts | null
  /** `message-appended`: a whole message, usually the user's, at once. */
  readonly message: ConversationMessageFacts | null
  /** `message-started`: which provider and model is producing this message. */
  readonly model: ModelRefFacts | null
  /** `message-started`; also carried by appended messages' own metadata. */
  readonly timestamp: string | null
  /** `message-delta`: a piece of text or reasoning, named by `deltaKind`. */
  readonly deltaKind: 'text' | 'reasoning' | null
  readonly delta: string | null
  /** `tool-input`: the call, addressed to the message that made it. */
  readonly toolCallId: string | null
  readonly toolName: string | null
  readonly input: Present<unknown> | null
  /** `tool-output` and `tool-output-error`: the answer, keyed by call id alone. */
  readonly output: Present<unknown> | null
  readonly errorText: string | null
  /**
   * `submission-settled`: who signed the failure, and what it said. Null
   * whenever the wire omitted the error or the field — never invented, so a
   * renderer can show "reason unknown" without lying. The provider's sentence
   * for the attempt a retry follows travels in the same field on
   * `submission-retrying`, read from the chunk's flat `error` string.
   */
  readonly errorName: string | null
  readonly errorType: string | null
  readonly errorMessage: string | null
  /** `message-completed`: what the message cost. */
  readonly usage: UsageFacts | null
  /**
   * `submission-retrying`: which retry the harness scheduled, out of what
   * budget, and how long the wait before the next attempt is. Wire facts
   * only — the count is the harness's own derived number, not one this side
   * keeps; null on every other chunk type.
   */
  readonly attempt: number | null
  readonly maxRetries: number | null
  readonly delayMs: number | null
}

/**
 * Reads one projected chunk off the wire.
 *
 * Lenient where a chunk can survive a broken field (it becomes `null` there)
 * and strict only on `type`, because a chunk with no type is not a fact about
 * anything.
 */
export function readChunkFacts(value: unknown): ChunkFacts | null {
  if (!isRecord(value)) return null
  const type = text(value['type'])
  if (type === null) return null
  const position = readChunkPosition(value['position'])

  const base = {
    type,
    position,
    messageId: text(value['messageId']),
    submissionId: text(value['submissionId']),
    outcome: null,
    snapshot: null,
    message: null,
    model: null,
    timestamp: text(value['timestamp']),
    deltaKind: null,
    delta: null,
    toolCallId: text(value['toolCallId']),
    toolName: text(value['toolName']),
    input: value['input'] === undefined ? null : readPresentJson(value['input']),
    output: value['output'] === undefined ? null : readPresentJson(value['output']),
    errorText: text(value['errorText']),
    errorName: null,
    errorType: null,
    errorMessage: null,
    usage: null,
    attempt: null,
    maxRetries: null,
    delayMs: null,
  }

  switch (type) {
    case 'conversation-reset':
      return {
        ...base,
        messageId: null,
        submissionId: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        snapshot:
          value['snapshot'] === undefined ? null : readConversationSnapshot(value['snapshot']),
      }
    case 'message-appended':
      return {
        ...base,
        submissionId: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        message: value['message'] === undefined ? null : readConversationMessage(value['message']),
      }
    case 'message-started':
      return {
        ...base,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        model: readModelRef(value['model']),
      }
    case 'message-delta':
      return {
        ...base,
        submissionId: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        deltaKind: oneOf(['text', 'reasoning'] as const, value['kind']),
        delta: typeof value['delta'] === 'string' ? value['delta'] : null,
      }
    case 'tool-input':
      return {
        ...base,
        submissionId: null,
        timestamp: null,
        output: null,
        errorText: null,
      }
    case 'tool-output':
      return {
        ...base,
        messageId: null,
        submissionId: null,
        timestamp: null,
        toolName: null,
        input: null,
        errorText: null,
      }
    case 'tool-output-error':
      return {
        ...base,
        messageId: null,
        submissionId: null,
        timestamp: null,
        toolName: null,
        input: null,
        output: null,
      }
    case 'message-completed':
      return {
        ...base,
        submissionId: null,
        toolCallId: null,
        toolName: null,
        timestamp: null,
        input: null,
        output: null,
        errorText: null,
        usage: value['usage'] === undefined ? null : readUsage(value['usage']),
      }
    case 'submission-retrying':
      // The harness's own announcement that a transient model failure is
      // being retried. Everything except the association fields and the
      // facts themselves is unread, mirroring how every other chunk type
      // narrows; a field that fails to read stays null rather than
      // inventing a number.
      return {
        ...base,
        messageId: null,
        snapshot: null,
        message: null,
        model: null,
        deltaKind: null,
        delta: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        errorName: null,
        errorType: null,
        errorMessage: text(value['error']),
        attempt: finiteNumber(value['attempt']),
        maxRetries: finiteNumber(value['maxRetries']),
        delayMs: finiteNumber(value['delayMs']),
      }
    case 'submission-settled': {
      const rawOutcome = value['outcome']
      const outcome =
        rawOutcome === 'completed' || rawOutcome === 'failed' || rawOutcome === 'aborted'
          ? rawOutcome
          : null
      // The one sentence a person could act on travels here. Task 25 dropped
      // it at exactly this line; the failure rendered as four empty completed
      // bubbles and nothing else.
      const error = readSettlementError(value['error'])
      return {
        ...base,
        messageId: null,
        timestamp: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        outcome,
        errorName: error.name,
        errorType: error.type,
        errorMessage: error.message,
      }
    }
    default:
      // An unknown chunk type survives as identity only. Everything else it
      // may carry is unread by definition — this side has never heard of it.
      return {
        ...base,
        messageId: null,
        submissionId: null,
        outcome: null,
        snapshot: null,
        message: null,
        model: null,
        timestamp: null,
        deltaKind: null,
        delta: null,
        toolCallId: null,
        toolName: null,
        input: null,
        output: null,
        errorText: null,
        errorName: null,
        errorType: null,
        errorMessage: null,
        usage: null,
        attempt: null,
        maxRetries: null,
        delayMs: null,
      }
  }
}
