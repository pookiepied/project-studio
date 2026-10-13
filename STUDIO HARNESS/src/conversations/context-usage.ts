import { observe, type FlueObservation } from "@flue/runtime";

import { STUDIO_AGENT_ID } from "../contracts/agents.js";
import type { StudioDatabase } from "../storage/database.js";

/**
 * How full a conversation's context window actually is.
 *
 * ---- Why this exists at all ------------------------------------------------
 *
 * The webview used to answer this itself, by counting the characters it had
 * rendered and dividing by four. That number was wrong by about half on a
 * working conversation, and wrong in one direction, because the transcript on
 * screen is not the request that was sent. Absent from it: the system prompt,
 * every tool definition, every tool call's input, every tool result, and every
 * image. On an agentic turn the tool traffic is usually the largest single
 * part of the prompt, so the estimate omitted most of what it was measuring.
 *
 * The honest number exists and is measured by the provider, but it does not
 * reach the webview by any of the obvious routes. Flue 2.0 stamps nothing into
 * message metadata, and its streaming protocol's `message-completed` chunk
 * carries `messageId` and a timestamp and no usage at all. Both were checked
 * against the protocol reference rather than assumed.
 *
 * What does carry it is the observation stream - the same one the titler
 * already watches. A `turn` observation is one model request, and its
 * `response.usage` is what the provider reported for that request. So the
 * number is recorded here, at the only place it is available, and served to
 * the webview instead of being guessed at the far end.
 *
 * ---- Why the latest turn, and not a sum ------------------------------------
 *
 * This is the mistake the shape of the data invites. A submission makes many
 * model requests - one per tool round trip - and each one resends the entire
 * conversation. Adding their usage together answers "how many tokens did this
 * conversation cost", which is a real question and a different one. What fills
 * the window is a single request, and the largest single request is the most
 * recent one, because the history only grows.
 *
 * So this keeps the latest, and "latest" is by arrival rather than by any
 * field on the observation: the stream is ordered, and a turn that has just
 * been observed is by construction the one whose prompt was longest.
 *
 * ---- What is deliberately not counted --------------------------------------
 *
 * Turns run by any agent other than Studio's own. The titler dispatches its
 * own runs through the same runtime, and they carry an `instanceId` derived
 * from the conversation - so without the agent check, a conversation's context
 * would appear to collapse to a few hundred tokens every time it was renamed.
 * That is one turn of an eight-word prompt overwriting the measurement of a
 * hundred-thousand-token one.
 *
 * Nor the summariser's own requests. A compaction is one or two model calls
 * whose prompt is the whole transcript, and they arrive on the same stream as
 * `turn` observations with `purpose: "compaction"`. Counted, the last thing
 * measured for a conversation that was just emptied would be the largest
 * request it ever made.
 *
 * ---- After a compaction --------------------------------------------------
 *
 * The window is empty and nothing has measured it. The last measured figure
 * says "full", which is now the wrong answer in the worst way, so the
 * `compaction` observation writes a provisional row: the summary the
 * summariser wrote, the recent tail Flue kept verbatim, and a fixed allowance
 * for the system prompt and tool definitions, which no provider itemises.
 * The row is marked as an estimate, the meter says so, and the next turn's
 * measurement replaces it.
 */

/** One provider-reported prompt, as the four parts it is billed in. */
export interface ConversationUsage {
  /** Prompt tokens the provider read fresh. */
  readonly input: number;
  /** Prompt tokens served from its cache. They occupy the window the same way. */
  readonly cacheRead: number;
  /** Prompt tokens written into its cache. Also part of the prompt. */
  readonly cacheWrite: number;
  /** What the model produced, reasoning included. */
  readonly output: number;
  /** When this was observed, so a reader can tell a stale answer from a fresh one. */
  readonly observedAt: number;
  /**
   * True for the provisional row written after a compaction, before any
   * request has measured the shortened conversation.
   */
  readonly estimated: boolean;
}

/**
 * What Flue keeps verbatim after a compaction, and what the prompt carries
 * that no usage report itemises. Both are round: the row they make is an
 * estimate by name, replaced by the first measured turn.
 */
const KEPT_TAIL_TOKENS = 8_000;
const FIXED_PROMPT_TOKENS = 12_000;

/** A number that is actually a number, and not a negative one. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Reads the usage off a `turn` observation, or answers undefined.
 *
 * Undefined for a turn that reported nothing, rather than a record of four
 * zeroes: a turn with no usage is a turn nobody measured, and storing zeroes
 * for it would overwrite a real measurement with a claim that the window is
 * empty. Exported for the test, which is the only way to pin that difference.
 */
function usageOf(observation: FlueObservation): ConversationUsage | undefined {
  if (observation.type !== "turn") return undefined;
  // Only the agent's own requests fill the agent's window.
  if (observation.purpose !== "agent") return undefined;
  const usage = observation.response?.usage;
  if (usage === undefined || usage === null) return undefined;
  const input = count(usage.input);
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  const output = count(usage.output);
  if (input + cacheRead + cacheWrite + output === 0) return undefined;
  return { input, cacheRead, cacheWrite, output, observedAt: Date.now(), estimated: false };
}

/**
 * The provisional figure after a compaction, or undefined for one that
 * failed or was cancelled - those wrote nothing, and the window is as it was.
 *
 * The summary is what the summariser produced, read off the compaction's own
 * usage; when a provider reports no output for it the tail and the fixed
 * allowance still stand, which is the honest floor.
 */
function usageAfterCompaction(observation: FlueObservation): ConversationUsage | undefined {
  if (observation.type !== "compaction" || observation.isError) return undefined;
  const summary = count(observation.usage?.output);
  return {
    input: summary + KEPT_TAIL_TOKENS + FIXED_PROMPT_TOKENS,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    observedAt: Date.now(),
    estimated: true,
  };
}

export interface ContextUsageOptions {
  /** Defaults to the runtime's live subscription; tests drive it by hand. */
  readonly subscribe?: (handler: (observation: FlueObservation) => void) => () => void;
  /**
   * Where the figure outlives the process. Without it the tracker is memory
   * only, which is what the unit tests want and what no running harness
   * should be.
   */
  readonly database?: StudioDatabase;
}

/**
 * The latest measured prompt for each conversation.
 *
 * ---- Why it is stored ------------------------------------------------------
 *
 * It was memory only, on the reasoning that the transcript outlives the
 * process and a measurement should not be a durable claim about a window
 * whose contents are reconstructed from elsewhere. That reasoning had the
 * frequencies backwards. The process is restarted far more often than any
 * transcript changes - every rebuild in development, every quit - and each
 * restart sent every conversation back to the webview's estimate until its
 * next turn. The estimate reads about a fifth of the real figure, so the
 * meter that had just been made honest looked broken again after every
 * restart, and was reported as such three times.
 *
 * The figure is the last request as the provider billed it. The transcript
 * cannot change without a request that replaces the figure, so a stored row
 * is exactly as true after a restart as it was before one. Memory stays as
 * the cache in front of the table; the table is what makes the answer
 * survive.
 */
export class ContextUsageTracker {
  readonly #latest = new Map<string, ConversationUsage>();
  readonly #subscribe: (handler: (observation: FlueObservation) => void) => () => void;
  readonly #db: StudioDatabase | undefined;
  #stop: (() => void) | undefined;

  constructor(options: ContextUsageOptions = {}) {
    this.#subscribe =
      options.subscribe ?? ((handler) => observe((observation) => handler(observation)));
    this.#db = options.database;
  }

  start(): void {
    if (this.#stop !== undefined) return;
    this.#stop = this.#subscribe((observation) => this.record(observation));
  }

  stop(): void {
    this.#stop?.();
    this.#stop = undefined;
  }

  /** What was last measured for one conversation, if anything ever was. */
  get(conversationId: string): ConversationUsage | undefined {
    const held = this.#latest.get(conversationId);
    if (held !== undefined) return held;
    const stored = this.#load(conversationId);
    if (stored !== undefined) this.#latest.set(conversationId, stored);
    return stored;
  }

  forget(conversationId: string): void {
    this.#latest.delete(conversationId);
    this.#db
      ?.prepare("DELETE FROM conversation_context_usage WHERE conversation_id = ?")
      .run(conversationId);
  }

  /**
   * Carries one conversation's figure to its fork, memory and table both.
   *
   * A fork opens on the same transcript, so its window is the same window
   * until its next turn measures otherwise. A fresh object, never the held
   * reference: the two conversations measure independently from here, and a
   * shared reference would let one turn's record rewrite the other's
   * memory. Nothing measured means nothing carried - an unmeasured fork is
   * unmeasured, not zeroed.
   */
  duplicateConversation(sourceId: string, targetId: string): void {
    const held = this.#latest.get(sourceId) ?? this.#load(sourceId);
    if (held === undefined) return;
    const carried: ConversationUsage = {
      input: held.input,
      cacheRead: held.cacheRead,
      cacheWrite: held.cacheWrite,
      output: held.output,
      observedAt: held.observedAt,
      estimated: held.estimated,
    };
    this.#latest.set(targetId, carried);
    if (this.#db !== undefined) this.#save(targetId, carried);
  }

  #load(conversationId: string): ConversationUsage | undefined {
    if (this.#db === undefined) return undefined;
    const row = this.#db
      .prepare(
        `SELECT input, cache_read, cache_write, output, observed_at, estimated
           FROM conversation_context_usage WHERE conversation_id = ?`,
      )
      .get(conversationId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      input: count(row.input),
      cacheRead: count(row.cache_read),
      cacheWrite: count(row.cache_write),
      output: count(row.output),
      observedAt: count(row.observed_at),
      estimated: row.estimated === 1,
    };
  }

  #save(conversationId: string, usage: ConversationUsage): void {
    this.#db
      ?.prepare(
        `INSERT INTO conversation_context_usage
           (conversation_id, input, cache_read, cache_write, output, observed_at, estimated)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           input = excluded.input,
           cache_read = excluded.cache_read,
           cache_write = excluded.cache_write,
           output = excluded.output,
           observed_at = excluded.observed_at,
           estimated = excluded.estimated`,
      )
      .run(
        conversationId,
        usage.input,
        usage.cacheRead,
        usage.cacheWrite,
        usage.output,
        usage.observedAt,
        usage.estimated ? 1 : 0,
      );
  }

  /**
   * Takes one observation. Public so the test drives the real path rather
   * than a copy of it.
   */
  record(observation: FlueObservation): void {
    // `instanceId` is our conversation id; Flue's own `conversationId` names
    // the durable stream and is a different thing entirely. Routing on that
    // one would file every measurement under a name the product never uses.
    const conversationId = observation.instanceId;
    if (typeof conversationId !== "string" || conversationId === "") return;
    if (observation.agentName !== STUDIO_AGENT_ID) return;
    const usage = usageOf(observation) ?? usageAfterCompaction(observation);
    if (usage === undefined) return;
    this.#latest.set(conversationId, usage);
    this.#save(conversationId, usage);
  }
}
