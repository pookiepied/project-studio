import type {
  FlueJournalBatchRow,
  FlueJournalStreamRow,
  FlueJournalSubmissionRow,
} from "../storage/flue-journal.js";
import type { ConversationRecord } from "../contracts/conversations.js";

/**
 * The conversation export walk: from Flue's journal rows to a self-describing
 * export a program can re-seed from and a person can read.
 *
 * Two layers are deliberate, and each one is the hedge for the other:
 *
 * - `entries` is the materialized transcript: user messages, assistant replies
 *   with their reasoning, text and tool blocks in order, tool results attached
 *   to their calls. This is the layer a person reads and the layer that
 *   survives without any of our code.
 * - `records` is the verbatim record stream the materialization came from, in
 *   stream order. The materialization is an interpretation written under
 *   deadline, against a schema this export cannot see; the records let a
 *   future importer re-derive everything without trusting it. Dropping the
 *   records would make this export's own reading of the data unfalsifiable.
 *
 * Everything is read from the tables, never assumed: the shapes below were
 * measured against a real schema-4 journal on 2026-09-01. A record type this
 * file has never heard of is preserved in `records` and counted in
 * `recordTypes`, never dropped and never fatal - the walk must survive a
 * schema that has moved on.
 */

export const EXPORT_FORMAT = "project-studio.conversation-export";
export const EXPORT_FORMAT_VERSION = 1;

/** What the export does with conversations the Studio index no longer knows. */
export type OrphanPolicy = "include" | "exclude" | "split";

/** One record as it arrived inside a batch's `data` JSON array. */
type JournalRecord = Record<string, unknown>;

/** Text content, the only content kind this machine's journal holds. */
interface ExportTextPart {
  readonly type: "text";
  readonly text: string;
}

interface ExportToolResult {
  readonly content: readonly ExportTextPart[];
  readonly isError: boolean;
  /** Whether a `tool_results_committed` record claims this outcome. */
  readonly committed: boolean;
}

type ExportBlock =
  | {
      readonly type: "reasoning";
      readonly text: string;
      /** The provider returned the reasoning encrypted; see `losses`. */
      readonly encrypted: boolean;
    }
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_call";
      readonly toolCallId: string;
      readonly name: string;
      readonly arguments: unknown;
      readonly result: ExportToolResult | null;
    };

interface ExportUserMessage {
  readonly role: "user";
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly submissionId: string | null;
  /**
   * A direct message, the titler's dispatch input, or a system signal the
   * runtime projects into the transcript as a user-role message (measured:
   * `submission_aborted` and `submission_interrupted` appear this way in the
   * SDK's own snapshot, so the export renders them the same way).
   */
  readonly via: "message" | "dispatch" | "signal";
  /** The signal's type when `via` is "signal"; null otherwise. */
  readonly signalType: string | null;
  /** Set when the stream never recorded the input and the submissions table lent it back. */
  readonly recoveredFrom: "flue_agent_submissions" | null;
  readonly text: string;
}

interface ExportAssistantMessage {
  readonly role: "assistant";
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly completedTimestamp: string | null;
  readonly submissionId: string | null;
  readonly model: {
    readonly api: string | null;
    readonly provider: string | null;
    readonly model: string | null;
  } | null;
  readonly blocks: readonly ExportBlock[];
  readonly stopReason: string | null;
  readonly usage: unknown;
  readonly error: string | null;
}

export type ExportMessage = ExportUserMessage | ExportAssistantMessage;

/** A non-message thing on the timeline: a retry, a settlement. */
interface ExportEvent {
  readonly kind: "retry" | "submission_settled";
  readonly timestamp: string | null;
  readonly submissionId: string | null;
  readonly summary: string;
}

/** One timeline slot, in true stream order. */
type ExportEntry =
  | { readonly kind: "message"; readonly message: ExportMessage }
  | { readonly kind: "event"; readonly event: ExportEvent };

interface ExportSubmission {
  readonly submissionId: string;
  readonly kind: string | null;
  readonly outcome: string | null;
  readonly error: string | null;
  /** True when the stream held no input record for this submission. */
  readonly recovered: boolean;
}

export interface ExportedStream {
  readonly path: string;
  readonly agent: string;
  /** Flue's own conversation id, from the creation record. */
  readonly flueConversationId: string | null;
  readonly createdAt: string | null;
  readonly streamOffset: number;
  readonly batchCount: number;
  readonly recordCount: number;
  readonly recordTypes: Readonly<Record<string, number>>;
  readonly entries: readonly ExportEntry[];
  readonly submissions: readonly ExportSubmission[];
  /** What could not be made readable, said out loud rather than dropped. */
  readonly losses: readonly string[];
  /** The verbatim parsed records, in stream order: the lossless layer. */
  readonly records: readonly JournalRecord[];
  /** Batches whose `data` could not be parsed, kept raw. */
  readonly unparsedBatches: readonly {
    readonly seq: number;
    readonly data: string;
  }[];
}

export interface ExportedConversation {
  /** Our index id (`cnv_*`), which is also Flue's stream `instanceId`. */
  readonly conversationId: string;
  readonly knownToStudio: boolean;
  readonly studio: ConversationRecord | null;
  readonly streams: readonly ExportedStream[];
}

export interface ExportCounts {
  readonly conversations: number;
  readonly streams: number;
  readonly knownConversations: number;
  readonly orphanedConversations: number;
  readonly userMessages: number;
  /** System signals the transcript renders as user-role messages. */
  readonly signalMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly records: number;
  readonly recoveredFromSubmissions: number;
  readonly unparsedBatches: number;
}

export interface ExportEnvelope {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: typeof EXPORT_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly source: {
    readonly database: string;
    readonly flueSchemaVersion: string | null;
    readonly runtime: string;
    readonly tables: readonly [
      "flue_conversation_streams",
      "flue_conversation_stream_batches",
      "flue_agent_submissions",
    ];
  };
  /** The orphan policy this file was written under. */
  readonly orphans: OrphanPolicy;
  readonly counts: ExportCounts;
  /** Journal-wide observations that belong to no single conversation. */
  readonly notes: readonly string[];
  readonly conversations: readonly ExportedConversation[];
}

// ---------------------------------------------------------------------------
// Field readers: the journal's records are JSON of unknown provenance, so
// every field is narrowed at the point of use rather than trusted.
// ---------------------------------------------------------------------------

function isJournalRecord(value: unknown): value is JournalRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordString(record: JournalRecord, field: string): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function recordNumber(record: JournalRecord, field: string): number | null {
  const value = record[field];
  return typeof value === "number" ? value : null;
}

function recordObject(
  record: JournalRecord,
  field: string,
): JournalRecord | null {
  const value = record[field];
  return isJournalRecord(value) ? value : null;
}

/** An array of objects, the shape every `content` field has. */
function recordArray(
  record: JournalRecord,
  field: string,
): readonly JournalRecord[] {
  const value = record[field];
  if (!Array.isArray(value)) return [];
  return value.filter(isJournalRecord);
}

/**
 * Text parts out of a `content` array. Non-text parts (images, files) are
 * reported through `losses` rather than invented into text.
 */
function textParts(content: readonly JournalRecord[]): {
  readonly parts: readonly ExportTextPart[];
  readonly nonTextTypes: readonly string[];
} {
  const parts: ExportTextPart[] = [];
  const nonTextTypes: string[] = [];
  for (const part of content) {
    const type = recordString(part, "type") ?? "unknown";
    const text = recordString(part, "text");
    if (type === "text" && text !== null) {
      parts.push({ type: "text", text });
    } else {
      nonTextTypes.push(type);
    }
  }
  return { parts, nonTextTypes };
}

function joinedDeltas(
  deltas: readonly { sequence: number | null; arrival: number; delta: string }[],
): string {
  // Stable sort by sequence: equal or absent sequence numbers keep arrival
  // order. Measured journals use contiguous 0..n-1 sequences per block; the
  // sort degrades to arrival order rather than scrambling if that ever moves.
  const ordered = [...deltas].sort((left, right) => {
    const leftKey = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightKey = right.sequence ?? Number.MAX_SAFE_INTEGER;
    return leftKey - rightKey;
  });
  return ordered.map((delta) => delta.delta).join("");
}

// ---------------------------------------------------------------------------
// Internal walk state, converted to the export shape once, at the end
// ---------------------------------------------------------------------------

interface BlockState {
  readonly blockId: string;
  readonly kind: "reasoning" | "text" | "tool_call";
  readonly order: number | null;
  readonly arrival: number;
  readonly deltas: { sequence: number | null; arrival: number; delta: string }[];
  encrypted: boolean;
  toolCallId: string | null;
  name: string | null;
  arguments: unknown;
}

interface MessageState {
  readonly role: "user" | "assistant";
  id: string | null;
  timestamp: string | null;
  submissionId: string | null;
  completedTimestamp: string | null;
  model: ExportAssistantMessage["model"];
  readonly blocks: Map<string, BlockState>;
  readonly blockArrival: string[];
  stopReason: string | null;
  usage: unknown;
  error: string | null;
  via: "message" | "dispatch" | "signal";
  signalType: string | null;
  recoveredFrom: "flue_agent_submissions" | null;
  text: string;
}

interface OutcomeState {
  readonly content: readonly ExportTextPart[];
  readonly isError: boolean;
  readonly recordId: string | null;
}

interface SubmissionState {
  readonly submissionId: string;
  kind: string | null;
  outcome: string | null;
  error: string | null;
  hasInputRecord: boolean;
  /** Set when this submission's message was recovered from the journal. */
  recovered: boolean;
}

type InternalEntry =
  | { readonly kind: "message"; readonly message: MessageState }
  | { readonly kind: "event"; readonly event: ExportEvent };

/** Parses one stream identity (`identity_json`) without trusting it. */
function readIdentity(
  identityJson: string,
  streamPath: string,
): { agent: string; conversationId: string } {
  const fallbackAgent = streamPath.split("/")[1] ?? "unknown";
  const fallbackId = streamPath.split("/").pop() ?? streamPath;
  let parsed: unknown;
  try {
    parsed = JSON.parse(identityJson);
  } catch {
    return { agent: fallbackAgent, conversationId: fallbackId };
  }
  if (!isJournalRecord(parsed)) {
    return { agent: fallbackAgent, conversationId: fallbackId };
  }
  return {
    agent: recordString(parsed, "agentName") ?? fallbackAgent,
    conversationId: recordString(parsed, "instanceId") ?? fallbackId,
  };
}

/** Parses a submission `payload` JSON string without trusting it. */
export function readSubmissionPayload(payload: string | null): {
  kind: string | null;
  agent: string | null;
  conversationId: string | null;
  message: string | null;
  acceptedAt: string | null;
} {
  const empty = {
    kind: null,
    agent: null,
    conversationId: null,
    message: null,
    acceptedAt: null,
  };
  if (payload === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return empty;
  }
  if (!isJournalRecord(parsed)) return empty;
  const inner = recordObject(parsed, "payload");
  return {
    kind: recordString(parsed, "kind"),
    agent: recordString(parsed, "agent"),
    conversationId: recordString(parsed, "id"),
    message: inner === null ? null : recordString(inner, "message"),
    acceptedAt: recordString(parsed, "acceptedAt"),
  };
}

/**
 * Walks one stream's batches into an exported stream.
 *
 * `submissions` is the journal's whole `flue_agent_submissions` table; the
 * walker attributes rows to this stream by their parsed payload, because the
 * table carries no stream path. Submissions whose input record never reached
 * the stream - measured to happen when a submission is aborted before its
 * input was journaled - lend their message back to the transcript, marked
 * `recoveredFrom`, placed at the position of their settlement record.
 */
export function walkStream(input: {
  readonly stream: FlueJournalStreamRow;
  readonly batches: readonly FlueJournalBatchRow[];
  readonly submissions: readonly FlueJournalSubmissionRow[];
}): ExportedStream {
  const { agent, conversationId } = readIdentity(
    input.stream.identityJson,
    input.stream.path,
  );

  const losses: string[] = [];
  const records: JournalRecord[] = [];
  const unparsedBatches: { seq: number; data: string }[] = [];
  const recordTypes: Record<string, number> = {};

  const internalEntries: InternalEntry[] = [];
  const messages = new Map<string, MessageState>();
  const outcomes = new Map<string, OutcomeState>();
  const committedRecordIds = new Set<string>();
  const submissions = new Map<string, SubmissionState>();

  let flueConversationId: string | null = null;
  let createdAt: string | null = null;
  let arrival = 0;

  const submissionState = (submissionId: string | null): SubmissionState | null => {
    if (submissionId === null) return null;
    const existing = submissions.get(submissionId);
    if (existing !== undefined) return existing;
    const created: SubmissionState = {
      submissionId,
      kind: null,
      outcome: null,
      error: null,
      hasInputRecord: false,
      recovered: false,
    };
    submissions.set(submissionId, created);
    return created;
  };

  const ensureAssistantMessage = (messageId: string | null): MessageState | null => {
    if (messageId === null) return null;
    const existing = messages.get(messageId);
    if (existing !== undefined) return existing;
    const created: MessageState = {
      role: "assistant",
      id: messageId,
      timestamp: null,
      submissionId: null,
      completedTimestamp: null,
      model: null,
      blocks: new Map(),
      blockArrival: [],
      stopReason: null,
      usage: null,
      error: null,
      via: "message",
      signalType: null,
      recoveredFrom: null,
      text: "",
    };
    messages.set(messageId, created);
    return created;
  };

  const ensureBlock = (
    message: MessageState,
    blockId: string,
    kind: BlockState["kind"],
    order: number | null,
  ): BlockState => {
    const existing = message.blocks.get(blockId);
    if (existing !== undefined) return existing;
    const created: BlockState = {
      blockId,
      kind,
      order,
      arrival: arrival++,
      deltas: [],
      encrypted: false,
      toolCallId: null,
      name: null,
      arguments: null,
    };
    message.blocks.set(blockId, created);
    message.blockArrival.push(blockId);
    return created;
  };

  const pushUserMessage = (message: MessageState, submissionId: string | null): void => {
    internalEntries.push({ kind: "message", message });
    const tracked = submissionState(submissionId);
    if (tracked !== null) tracked.hasInputRecord = true;
  };

  for (const batch of input.batches) {
    let parsedBatch: unknown;
    try {
      parsedBatch = JSON.parse(batch.data);
    } catch {
      unparsedBatches.push({ seq: batch.seq, data: batch.data });
      losses.push(
        `batch ${batch.seq} could not be parsed as a JSON record array; ` +
          "its raw bytes are preserved in unparsedBatches.",
      );
      continue;
    }
    if (!Array.isArray(parsedBatch)) {
      unparsedBatches.push({ seq: batch.seq, data: batch.data });
      losses.push(
        `batch ${batch.seq} held ${typeof parsedBatch} where a record array ` +
          "was expected; its raw bytes are preserved in unparsedBatches.",
      );
      continue;
    }

    for (const raw of parsedBatch) {
      if (!isJournalRecord(raw)) {
        unparsedBatches.push({ seq: batch.seq, data: JSON.stringify(raw) });
        continue;
      }
      records.push(raw);
      const type = recordString(raw, "type") ?? "unknown";
      recordTypes[type] = (recordTypes[type] ?? 0) + 1;

      switch (type) {
        case "conversation_created": {
          flueConversationId = recordString(raw, "conversationId");
          createdAt = recordString(raw, "createdAt");
          break;
        }

        case "user_message": {
          const { parts, nonTextTypes } = textParts(recordArray(raw, "content"));
          if (nonTextTypes.length > 0) {
            losses.push(
              "a user message carried " +
                `${nonTextTypes.join(", ")} content, which is preserved in ` +
                "records but not rendered in the transcript.",
            );
          }
          const submissionId = recordString(raw, "submissionId");
          pushUserMessage(
            {
              role: "user",
              id: recordString(raw, "messageId"),
              timestamp: recordString(raw, "timestamp"),
              submissionId,
              completedTimestamp: null,
              model: null,
              blocks: new Map(),
              blockArrival: [],
              stopReason: null,
              usage: null,
              error: null,
              via: "message",
              signalType: null,
              recoveredFrom: null,
              text: parts.map((part) => part.text).join(""),
            },
            submissionId,
          );
          break;
        }

        case "signal": {
          const signalType = recordString(raw, "signalType");
          if (signalType === "dispatch_input") {
            // The titler's input arrives as a dispatch signal whose content
            // is a JSON string carrying the message.
            const content = recordString(raw, "content");
            let text: string | null = null;
            if (content !== null) {
              try {
                const parsedContent: unknown = JSON.parse(content);
                if (isJournalRecord(parsedContent)) {
                  text = recordString(parsedContent, "message");
                }
              } catch {
                // Not JSON: the raw content is the message itself.
              }
              if (text === null) text = content;
            } else {
              losses.push("a dispatch input carried no content.");
            }
            const submissionId = recordString(raw, "submissionId");
            pushUserMessage(
              {
                role: "user",
                id: recordString(raw, "messageId"),
                timestamp: recordString(raw, "timestamp"),
                submissionId,
                completedTimestamp: null,
                model: null,
                blocks: new Map(),
                blockArrival: [],
                stopReason: null,
                usage: null,
                error: null,
                via: "dispatch",
                signalType: signalType,
                recoveredFrom: null,
                text: text ?? "",
              },
              submissionId,
            );
          } else {
            // Measured against the SDK's own projection: a non-dispatch
            // signal (submission_aborted, submission_interrupted) is rendered
            // in the transcript as a user-role message carrying the signal's
            // text. The export matches that, and keeps the type visible.
            const submissionId = recordString(raw, "submissionId");
            pushUserMessage(
              {
                role: "user",
                id: recordString(raw, "messageId"),
                timestamp: recordString(raw, "timestamp"),
                submissionId,
                completedTimestamp: null,
                model: null,
                blocks: new Map(),
                blockArrival: [],
                stopReason: null,
                usage: null,
                error: null,
                via: "signal",
                signalType: signalType,
                recoveredFrom: null,
                text: recordString(raw, "content") ?? "",
              },
              submissionId,
            );
          }
          break;
        }

        case "assistant_message_started": {
          const message = ensureAssistantMessage(recordString(raw, "messageId"));
          if (message === null) {
            losses.push("an assistant message started without a message id.");
            break;
          }
          message.timestamp = recordString(raw, "timestamp");
          message.submissionId = recordString(raw, "submissionId");
          const modelInfo = recordObject(raw, "modelInfo");
          message.model =
            modelInfo === null
              ? null
              : {
                  api: recordString(modelInfo, "api"),
                  provider: recordString(modelInfo, "provider"),
                  model: recordString(modelInfo, "model"),
                };
          internalEntries.push({ kind: "message", message });
          break;
        }

        case "assistant_reasoning_started":
        case "assistant_text_started": {
          const message = ensureAssistantMessage(recordString(raw, "messageId"));
          const blockId = recordString(raw, "blockId");
          if (message === null || blockId === null) {
            losses.push(`a ${type} record could not be attached to a message.`);
            break;
          }
          const kind = type === "assistant_reasoning_started" ? "reasoning" : "text";
          ensureBlock(message, blockId, kind, recordNumber(raw, "blockIndex"));
          break;
        }

        case "assistant_reasoning_delta":
        case "assistant_text_delta": {
          const messageId = recordString(raw, "messageId");
          const message =
            messageId === null ? null : (messages.get(messageId) ?? null);
          const blockId = recordString(raw, "blockId");
          if (message === null || blockId === null) {
            losses.push(`a ${type} record could not be attached to a message.`);
            break;
          }
          const kind = type === "assistant_reasoning_delta" ? "reasoning" : "text";
          const block = ensureBlock(
            message,
            blockId,
            kind,
            recordNumber(raw, "blockIndex"),
          );
          block.deltas.push({
            sequence: recordNumber(raw, "sequence"),
            arrival: arrival++,
            delta: recordString(raw, "delta") ?? "",
          });
          break;
        }

        case "assistant_reasoning_completed":
        case "assistant_text_completed": {
          const messageId = recordString(raw, "messageId");
          const message =
            messageId === null ? null : (messages.get(messageId) ?? null);
          const blockId = recordString(raw, "blockId");
          const block =
            message === null || blockId === null
              ? undefined
              : message.blocks.get(blockId);
          if (block !== undefined && type === "assistant_reasoning_completed") {
            block.encrypted = recordString(raw, "encrypted") !== null;
          }
          break;
        }

        case "assistant_tool_call": {
          const message = ensureAssistantMessage(recordString(raw, "messageId"));
          const blockId = recordString(raw, "blockId");
          if (message === null || blockId === null) {
            losses.push("a tool call could not be attached to a message.");
            break;
          }
          const block = ensureBlock(
            message,
            blockId,
            "tool_call",
            recordNumber(raw, "blockIndex"),
          );
          block.toolCallId = recordString(raw, "toolCallId");
          block.name = recordString(raw, "name");
          block.arguments = raw["arguments"] ?? null;
          break;
        }

        case "tool_outcome": {
          const toolCallId = recordString(raw, "toolCallId");
          if (toolCallId === null) {
            losses.push("a tool outcome named no tool call id.");
            break;
          }
          const { parts } = textParts(recordArray(raw, "content"));
          const recordId = recordString(raw, "id");
          const outcome: OutcomeState = {
            content: parts,
            isError: raw["isError"] === true,
            recordId,
          };
          outcomes.set(toolCallId, outcome);
          break;
        }

        case "tool_results_committed": {
          // `outcomeIds` is an array of the outcome records' own ids - plain
          // strings, measured on a real journal, not objects.
          const outcomeIds = raw["outcomeIds"];
          if (!Array.isArray(outcomeIds)) break;
          for (const element of outcomeIds) {
            if (typeof element === "string") committedRecordIds.add(element);
          }
          break;
        }

        case "assistant_message_completed": {
          const messageId = recordString(raw, "messageId");
          const message =
            messageId === null ? null : (messages.get(messageId) ?? null);
          if (message === null) {
            losses.push("an assistant message completed without a matching start.");
            break;
          }
          message.completedTimestamp = recordString(raw, "timestamp");
          message.stopReason = recordString(raw, "stopReason");
          message.usage = recordObject(raw, "usage");
          message.error = recordString(raw, "error");
          break;
        }

        case "submission_retry_scheduled": {
          internalEntries.push({
            kind: "event",
            event: {
              kind: "retry",
              timestamp: recordString(raw, "timestamp"),
              submissionId: recordString(raw, "submissionId"),
              summary:
                `retry ${recordNumber(raw, "attempt") ?? "?"} of ` +
                `${recordNumber(raw, "maxRetries") ?? "?"} scheduled in ` +
                `${recordNumber(raw, "delayMs") ?? "?"}ms` +
                (recordString(raw, "error") !== null
                  ? ` after: ${recordString(raw, "error")}`
                  : ""),
            },
          });
          break;
        }

        case "submission_settled": {
          const submissionId = recordString(raw, "submissionId");
          const tracked = submissionState(submissionId);
          const outcome = recordString(raw, "outcome");
          const errorRecord = recordObject(raw, "error");
          const errorText =
            errorRecord === null ? null : recordString(errorRecord, "message");
          if (tracked !== null) {
            tracked.outcome = outcome;
            if (tracked.error === null) tracked.error = errorText;
          }
          if (outcome !== null && outcome !== "completed") {
            internalEntries.push({
              kind: "event",
              event: {
                kind: "submission_settled",
                timestamp: recordString(raw, "timestamp"),
                submissionId,
                summary:
                  `submission ${outcome}` +
                  (errorText === null ? "" : `: ${errorText}`),
              },
            });
          }
          break;
        }

        default: {
          // Unknown record type: kept in `records`, counted, and left alone.
          break;
        }
      }
    }
  }

  // --- recovered inputs: submissions this stream owns but never journaled ---

  const recovered: { message: MessageState; submissionId: string }[] = [];
  for (const row of input.submissions) {
    const payload = readSubmissionPayload(row.payload);
    if (payload.agent !== agent || payload.conversationId !== conversationId) continue;

    const tracked = submissionState(row.submissionId);
    if (tracked === null) continue;
    tracked.kind = payload.kind;
    if (tracked.error === null && row.error !== null) tracked.error = row.error;

    // The stream itself is the truth about whether the input was journaled;
    // a submission whose message arrived normally is not recovered.
    if (tracked.hasInputRecord) continue;
    if (payload.message === null) {
      losses.push(
        `submission ${row.submissionId} has a journal payload but no message ` +
          "text and no input record in the stream.",
      );
      continue;
    }

    tracked.hasInputRecord = true;
    tracked.recovered = true;
    recovered.push({
      submissionId: row.submissionId,
      message: {
        role: "user",
        id: null,
        timestamp: payload.acceptedAt,
        submissionId: row.submissionId,
        completedTimestamp: null,
        model: null,
        blocks: new Map(),
        blockArrival: [],
        stopReason: null,
        usage: null,
        error: null,
        via: payload.kind === "dispatch" ? "dispatch" : "message",
        signalType: null,
        recoveredFrom: "flue_agent_submissions",
        text: payload.message,
      },
    });
  }

  // A recovered message goes immediately before its settlement record when
  // one exists (the stream's own anchor for that submission), otherwise at
  // the end, in acceptance order.
  for (const item of recovered) {
    const settledIndex = internalEntries.findIndex(
      (entry) =>
        entry.kind === "event" &&
        entry.event.kind === "submission_settled" &&
        entry.event.submissionId === item.submissionId,
    );
    const entry: InternalEntry = { kind: "message", message: item.message };
    if (settledIndex >= 0) {
      internalEntries.splice(settledIndex, 0, entry);
    } else {
      internalEntries.push(entry);
    }
  }

  // --- conversion: internal state to the export shape ---

  const consumedOutcomes = new Set<string>();
  const entries: ExportEntry[] = internalEntries.map((entry) => {
    if (entry.kind === "event") return entry;
    const message = entry.message;
    if (message.role === "user") {
      const exported: ExportUserMessage = {
        role: "user",
        id: message.id,
        timestamp: message.timestamp,
        submissionId: message.submissionId,
        via: message.via,
        signalType: message.signalType,
        recoveredFrom: message.recoveredFrom,
        text: message.text,
      };
      return { kind: "message", message: exported };
    }

    const blocks: ExportBlock[] = message.blockArrival
      .map((blockId) => message.blocks.get(blockId))
      .filter((block): block is BlockState => block !== undefined)
      .sort((left, right) => {
        // Stable: blocks without an index keep arrival order after indexed ones.
        const leftKey = left.order ?? Number.MAX_SAFE_INTEGER;
        const rightKey = right.order ?? Number.MAX_SAFE_INTEGER;
        return leftKey - rightKey;
      })
      .map((block) => {
        if (block.kind === "tool_call") {
          if (block.toolCallId !== null) consumedOutcomes.add(block.toolCallId);
          const outcome =
            block.toolCallId === null ? undefined : outcomes.get(block.toolCallId);
          return {
            type: "tool_call",
            toolCallId: block.toolCallId ?? "",
            name: block.name ?? "unknown",
            arguments: block.arguments,
            result:
              outcome === undefined
                ? null
                : {
                    content: outcome.content,
                    isError: outcome.isError,
                    committed:
                      outcome.recordId !== null &&
                      committedRecordIds.has(outcome.recordId),
                  },
          };
        }
        const text = joinedDeltas(block.deltas);
        if (block.kind === "reasoning") {
          return { type: "reasoning", text, encrypted: block.encrypted };
        }
        return { type: "text", text };
      });

    const exported: ExportAssistantMessage = {
      role: "assistant",
      id: message.id,
      timestamp: message.timestamp,
      completedTimestamp: message.completedTimestamp,
      submissionId: message.submissionId,
      model: message.model,
      blocks,
      stopReason: message.stopReason,
      usage: message.usage,
      error: message.error,
    };
    return { kind: "message", message: exported };
  });

  // --- what could not be paired is said, not dropped ---

  for (const toolCallId of outcomes.keys()) {
    if (!consumedOutcomes.has(toolCallId)) {
      losses.push(
        `a tool result for call ${toolCallId} has no recorded tool call; ` +
          "the result text is preserved in records but not shown in the transcript.",
      );
    }
  }

  for (const message of messages.values()) {
    for (const block of message.blocks.values()) {
      if (
        block.kind === "reasoning" &&
        block.encrypted &&
        joinedDeltas(block.deltas) === ""
      ) {
        losses.push(
          "a reasoning block arrived encrypted with no decodable text; the " +
            "provider's reasoning content could not survive.",
        );
      }
    }
  }

  return {
    path: input.stream.path,
    agent,
    flueConversationId,
    createdAt,
    streamOffset: input.stream.nextOffset,
    batchCount: input.batches.length,
    recordCount: records.length,
    recordTypes,
    entries,
    submissions: [...submissions.values()]
      .filter((tracked) => tracked.hasInputRecord || tracked.outcome !== null)
      .map((tracked) => ({
        submissionId: tracked.submissionId,
        kind: tracked.kind,
        outcome: tracked.outcome,
        error: tracked.error,
        recovered: tracked.recovered,
      })),
    losses,
    records,
    unparsedBatches,
  };
}

/**
 * Groups walked streams into conversations keyed by our index id, and marks
 * provenance. `known` maps our conversation ids to their index records; a
 * stream whose id is absent from it is an orphan - a conversation the user
 * deleted, whose transcript outlived the delete.
 */
export function groupConversations(
  streams: readonly ExportedStream[],
  known: ReadonlyMap<string, ConversationRecord>,
): ExportedConversation[] {
  const groups = new Map<string, ExportedStream[]>();
  for (const stream of streams) {
    const id = stream.path.split("/").pop() ?? stream.path;
    const existing = groups.get(id);
    if (existing !== undefined) {
      existing.push(stream);
    } else {
      groups.set(id, [stream]);
    }
  }

  return [...groups.entries()]
    .map(([conversationId, group]) => {
      const record = known.get(conversationId) ?? null;
      return {
        conversationId,
        knownToStudio: record !== null,
        studio: record,
        // The studio agent's transcript first; any side agent (the titler)
        // after, in path order for determinism.
        streams: [...group].sort((left, right) => {
          const leftStudio = left.agent === "studio" ? 0 : 1;
          const rightStudio = right.agent === "studio" ? 0 : 1;
          return leftStudio - rightStudio || left.path.localeCompare(right.path);
        }),
      };
    })
    .sort((left, right) => left.conversationId.localeCompare(right.conversationId));
}

/** Counts across a set of exported conversations, for the envelope. */
export function countConversations(
  conversations: readonly ExportedConversation[],
): ExportCounts {
  let streams = 0;
  let userMessages = 0;
  let signalMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  let records = 0;
  let recovered = 0;
  let unparsed = 0;

  for (const conversation of conversations) {
    for (const stream of conversation.streams) {
      streams += 1;
      records += stream.recordCount;
      recovered += stream.submissions.filter(
        (submission) => submission.recovered,
      ).length;
      unparsed += stream.unparsedBatches.length;
      for (const entry of stream.entries) {
        if (entry.kind !== "message") continue;
        if (entry.message.role === "user") {
          if (entry.message.via === "signal") signalMessages += 1;
          else userMessages += 1;
          continue;
        }
        assistantMessages += 1;
        for (const block of entry.message.blocks) {
          if (block.type === "tool_call") {
            toolCalls += 1;
            if (block.result !== null) toolResults += 1;
          }
        }
      }
    }
  }

  return {
    conversations: conversations.length,
    streams,
    knownConversations: conversations.filter(
      (conversation) => conversation.knownToStudio,
    ).length,
    orphanedConversations: conversations.filter(
      (conversation) => !conversation.knownToStudio,
    ).length,
    userMessages,
    signalMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    records,
    recoveredFromSubmissions: recovered,
    unparsedBatches: unparsed,
  };
}
