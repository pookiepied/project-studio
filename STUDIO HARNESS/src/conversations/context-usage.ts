import { observe, type FlueObservation } from "@flue/runtime";

import { STUDIO_AGENT_ID } from "../contracts/agents.js";

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
}

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
export function usageOf(observation: FlueObservation): ConversationUsage | undefined {
  if (observation.type !== "turn") return undefined;
  const usage = observation.response?.usage;
  if (usage === undefined || usage === null) return undefined;
  const input = count(usage.input);
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  const output = count(usage.output);
  if (input + cacheRead + cacheWrite + output === 0) return undefined;
  return { input, cacheRead, cacheWrite, output, observedAt: Date.now() };
}

export interface ContextUsageOptions {
  /** Defaults to the runtime's live subscription; tests drive it by hand. */
  readonly subscribe?: (handler: (observation: FlueObservation) => void) => () => void;
}

/**
 * The latest measured prompt for each conversation.
 *
 * In memory. The measurement describes the transcript as it stands, and the
 * transcript outlives the process, so a restart does lose it - the webview
 * falls back to its estimate for one turn and is corrected the moment the
 * conversation is used again. Persisting it would mean a durable claim about
 * a window whose contents are reconstructed from elsewhere, and a stale row
 * that reads as authoritative is worse than an estimate that admits it is one.
 */
export class ContextUsageTracker {
  readonly #latest = new Map<string, ConversationUsage>();
  readonly #subscribe: (handler: (observation: FlueObservation) => void) => () => void;
  #stop: (() => void) | undefined;

  constructor(options: ContextUsageOptions = {}) {
    this.#subscribe =
      options.subscribe ?? ((handler) => observe((observation) => handler(observation)));
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
    return this.#latest.get(conversationId);
  }

  forget(conversationId: string): void {
    this.#latest.delete(conversationId);
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
    const usage = usageOf(observation);
    if (usage === undefined) return;
    this.#latest.set(conversationId, usage);
  }
}
