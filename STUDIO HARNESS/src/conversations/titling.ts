import { dispatch, observe, type FlueObservation } from "@flue/runtime";

import { STUDIO_AGENT_ID, TITLE_AGENT_ID } from "../contracts/agents.js";
import type { Logger } from "../observability/logger.js";
import type { ConversationStore } from "./store.js";

/**
 * The seam the admission path uses to hand a first message to titling. The
 * orchestrator implements it; the middleware depends on the shape, so the
 * HTTP layer never imports the orchestrator's machinery.
 */
export interface ConversationTitlingPort {
  /**
   * Records that this process admitted a conversation's first turn and holds
   * the words it was sent with. The model title, if one arrives, is written
   * only for conversations that came through here - the trigger for titling
   * is the first exchange settling, and the words are only in hand at
   * admission.
   */
  firstAdmission(conversationId: string, firstMessage: string): void;
}

/** How long a reply may be and still be a session-list title. */
const MAX_TITLE_CHARS = 120;

/** How many first admissions this process will hold waiting for a settle. */
const MAX_PENDING = 50;

/**
 * How much of the first message the titling agent is sent.
 *
 * The prompt asks for the primary task or topic, which lives at the head of
 * a message; the tail of a long one is usually the very material the rules
 * say not to answer. A fork's seed is a rendered transcript and can be far
 * longer than any title needs.
 */
const MAX_MESSAGE_CHARS = 4000;

/**
 * The retry contract with the title agent, stated once.
 *
 * Attempt N (N >= 1) is dispatched to the instance id `<conversation
 * id>-t<N>`, and the agent's initializer reads the suffix to step one rung
 * down the model ladder. A fresh instance id is what makes the model choice
 * move: the initializer sees the id and nothing else, and a fresh id is a
 * clean single-shot stream instead of a second exchange stapled onto a
 * failed one. The suffix cannot collide with a real conversation id: the
 * webview mints `cnv_<uuid>`, and `t` is not a hexadecimal digit, so no
 * uuid ends in `-t<digits>`.
 */
const ATTEMPT_SUFFIX = /-t(\d+)$/;

/** The conversation id an instance id belongs to. */
function conversationIdOf(instanceId: string): string {
  return instanceId.replace(ATTEMPT_SUFFIX, "");
}

/** One bounded second chance: the ladder, not a loop. */
const MAX_ATTEMPTS = 2;

/**
 * Parses a titling reply into a title, and refuses everything else.
 *
 * The contract with the agent is one JSON object with one string field -
 * exactly that, so a reply that wraps the object in prose, returns a bare
 * string, adds a second field, or spills a list is a failure, and a failure
 * keeps the derived title. The same gate rejects a title that is empty, one
 * that carries a line break, or one long enough to stop being a session-list
 * row.
 *
 * Returns undefined for every refusal; the caller logs and moves on.
 */
export function titleFromReply(reply: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const entries = Object.entries(parsed);
  if (entries.length !== 1) return undefined;
  const field = entries[0];
  if (field === undefined) return undefined;
  const [name, value] = field;
  if (name !== "title") return undefined;
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  if (title === "" || title.length > MAX_TITLE_CHARS) return undefined;
  if (title.includes("\n") || title.includes("\r")) return undefined;
  return title;
}

/** The one field the orchestrator reads off a settled prompt: its text. */
function replyText(result: unknown): { text: string; model: string | undefined } | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  if (!("text" in result)) return undefined;
  const text: unknown = result.text;
  if (typeof text !== "string") return undefined;
  return { text, model: replyModel(result) };
}

/** The model that produced the reply, when the result names one. */
function replyModel(result: object): string | undefined {
  if (!("model" in result)) return undefined;
  const model: unknown = result.model;
  if (typeof model !== "object" || model === null) return undefined;
  if (!("provider" in model) || !("id" in model)) return undefined;
  const provider: unknown = model.provider;
  const id: unknown = model.id;
  if (typeof provider !== "string" || typeof id !== "string") return undefined;
  return `${provider}/${id}`;
}

export interface ConversationTitlerOptions {
  /** The conversation index: read for the guards, written for the title. */
  readonly conversations: ConversationStore;
  readonly logger?: Logger;
  /**
   * Defaults to the runtime's own live subscription. Tests inject a queue so
   * the settlement handlers can be driven without a running Flue.
   */
  readonly subscribe?: (
    handler: (observation: FlueObservation) => void,
  ) => () => void;
  /**
   * Defaults to the runtime's in-process dispatch to the title agent. The
   * third argument is the attempt number: zero is the conversation's own
   * instance id, a retry is `<id>-t<N>`, which is how the agent's
   * initializer knows to step down the model ladder. Tests inject a
   * recorder; production wraps `dispatch()` with the fixed shape.
   */
  readonly dispatchJob?: (
    conversationId: string,
    message: string,
    attempt: number,
  ) => Promise<void>;
}

/**
 * The conversation's name, improved once.
 *
 * `deriveTitle` names a conversation at admission from its first eight
 * words. This module is the second, smarter naming pass: after the first
 * exchange has actually settled - the request was real, the turn completed -
 * it sends the first message to the title agent and writes the parsed reply
 * into the index, exactly once, and only while no person has named the
 * conversation first.
 *
 * The pieces, and why each is where it is:
 *
 * - **The trigger** is the studio agent's first prompt operation settling
 *   successfully (`operation`, kind `prompt`, not an error, agent
 *   `studio`). Admission is too early: a turn that is refused or dies would
 *   have spent a model call on an exchange that never happened. The
 *   operation event is the runtime's stable contract for "this exchange
 *   finished".
 * - **The words** are captured at first admission, not read back out of any
 *   event: the turn-settings middleware reads the submission body on the way
 *   in (it already does, for the model settings) and hands the message here.
 *   An in-memory map is enough because it only has to outlive the first
 *   exchange; a harness restart loses it, and a conversation whose first
 *   exchange settles after a restart simply keeps its derived title - honest,
 *   and never wrong.
 * - **The write** is the store's guarded `titleAutomatically`, which
 *   declines when a rename arrived first. The model works for seconds after
 *   the exchange settles; a rename inside that window outranks it, the same
 *   way it outranks the derivation.
 * - **Failures** - dispatch refused, model down, unusable reply - are logged
 *   and end the job. The derived title stays; a failed titling never fails a
 *   turn and never reaches the UI as an error, because nothing here is on
 *   any turn's path: the turn already settled.
 */
export class ConversationTitler implements ConversationTitlingPort {
  readonly #conversations: ConversationStore;
  readonly #logger: Logger | undefined;
  readonly #subscribe: NonNullable<ConversationTitlerOptions["subscribe"]>;
  readonly #dispatchJob: NonNullable<ConversationTitlerOptions["dispatchJob"]>;
  readonly #pending = new Map<string, string>();
  /**
   * Jobs in flight, keyed by conversation id: the words (kept so a failed
   * attempt can be re-sent) and how many attempts have been made. Bounded
   * with `pending` - an entry lives until the job lands or the ladder is
   * exhausted.
   */
  readonly #inFlight = new Map<string, { message: string; attempts: number }>();
  #unsubscribe: (() => void) | undefined;

  constructor(options: ConversationTitlerOptions) {
    this.#conversations = options.conversations;
    this.#logger = options.logger;
    this.#subscribe =
      options.subscribe ??
      ((handler) =>
        observe((observation) => {
          handler(observation);
        }));
    this.#dispatchJob =
      options.dispatchJob ??
      (async (conversationId, message, attempt) => {
        const instanceId =
          attempt === 0 ? conversationId : `${conversationId}-t${attempt}`;
        await dispatch({
          agent: TITLE_AGENT_ID,
          id: instanceId,
          input: { message },
        });
      });
  }

  /** Begins watching for settled exchanges. Idempotent. */
  start(): void {
    if (this.#unsubscribe !== undefined) return;
    this.#unsubscribe = this.#subscribe((observation) => {
      try {
        this.#onObservation(observation);
      } catch (error) {
        // A titling fault must never break the emission path it is called
        // from; the runtime would absorb it, but the log line is ours to
        // write.
        this.#logger?.warn("Conversation titling observed a fault.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** Stops watching. In-flight title jobs settle on their own stream. */
  stop(): void {
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = undefined;
    unsubscribe?.();
  }

  firstAdmission(conversationId: string, firstMessage: string): void {
    // One name per conversation: the entry is consumed by the first settled
    // exchange, so a map that only ever grows is a map of conversations
    // whose first turn never settled in this process. Bounded on purpose.
    if (this.#pending.size >= MAX_PENDING) {
      const oldest = this.#pending.keys().next();
      if (!oldest.done) this.#pending.delete(oldest.value);
    }
    this.#pending.set(
      conversationId,
      firstMessage.length > MAX_MESSAGE_CHARS
        ? firstMessage.slice(0, MAX_MESSAGE_CHARS)
        : firstMessage,
    );
  }

  #onObservation(observation: FlueObservation): void {
    if (observation.type !== "operation") return;
    if (observation.operationKind !== "prompt") return;
    const conversationId = observation.instanceId;
    if (typeof conversationId !== "string" || conversationId === "") return;

    if (observation.agentName === STUDIO_AGENT_ID) {
      if (!observation.isError) this.#studioExchangeSettled(conversationId);
      return;
    }
    if (observation.agentName === TITLE_AGENT_ID) {
      if (observation.isError) this.#titleAttemptFailed(conversationId);
      else this.#titleReplySettled(conversationId, observation.result);
    }
  }

  #studioExchangeSettled(conversationId: string): void {
    const message = this.#pending.get(conversationId);
    if (message === undefined) return;
    // Consumed now: exactly one titling job per conversation, whatever
    // happens below, and an old conversation's later turn - this process
    // restarted after its first exchange - finds nothing here.
    this.#pending.delete(conversationId);

    const row = this.#conversations.get(conversationId);
    if (row === undefined) {
      // The row the admission created is gone; a first send refused after
      // admission removes it (Task 33), and there is nothing left to name.
      return;
    }
    if (row.titleManual) return;

    this.#inFlight.set(conversationId, { message, attempts: 1 });
    this.#dispatch(conversationId, message, 0);
  }

  /** Sends one attempt; a refused dispatch is logged, never thrown. */
  #dispatch(conversationId: string, message: string, attempt: number): void {
    void this.#dispatchJob(conversationId, message, attempt)
      .then(() => {
        this.#logger?.info("Conversation titling dispatched.", {
          conversation_id: conversationId,
          attempt,
        });
      })
      .catch((error: unknown) => {
        // The dispatch itself refused - unknown agent, unservable model, a
        // runtime shutting down. The ladder ends here either way.
        this.#logger?.warn("Conversation titling could not be dispatched.", {
          conversation_id: conversationId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        this.#inFlight.delete(conversationId);
      });
  }

  /**
   * A title run failed at the model or the runtime - not a bad reply, which
   * settles successfully and is refused in `#titleReplySettled`. One rung
   * down the ladder, once; a job still in flight without a message (a run
   * recovered after a restart) simply ends.
   */
  #titleAttemptFailed(instanceId: string): void {
    const conversationId = conversationIdOf(instanceId);
    const job = this.#inFlight.get(conversationId);
    if (job === undefined) return;
    if (job.attempts >= MAX_ATTEMPTS) {
      this.#logger?.warn("Conversation titling failed; keeping the derived title.", {
        conversation_id: conversationId,
      });
      this.#inFlight.delete(conversationId);
      return;
    }
    job.attempts += 1;
    this.#dispatch(conversationId, job.message, job.attempts - 1);
  }

  #titleReplySettled(instanceId: string, result: unknown): void {
    const conversationId = conversationIdOf(instanceId);
    const reply = replyText(result);
    if (reply === undefined) {
      this.#logger?.warn("Conversation titling reply carried no text.", {
        conversation_id: conversationId,
      });
      this.#inFlight.delete(conversationId);
      return;
    }
    const title = titleFromReply(reply.text);
    if (title === undefined) {
      // The model answered but not in the contract's shape. Stepping down
      // the ladder cannot fix a model that will not follow the prompt; the
      // derived title stands.
      this.#logger?.warn("Conversation titling reply was not a usable title.", {
        conversation_id: conversationId,
      });
      this.#inFlight.delete(conversationId);
      return;
    }
    const record = this.#conversations.titleAutomatically(conversationId, title);
    this.#inFlight.delete(conversationId);
    if (record === undefined) {
      // Renamed while the title agent worked, or purged outright. Either
      // way the person's state stands.
      return;
    }
    // The model is part of the fact: titling is supposed to be the cheap
    // pass, and the log is where that stays checkable.
    this.#logger?.info("Conversation titled.", {
      conversation_id: conversationId,
      ...(reply.model === undefined ? {} : { title_model: reply.model }),
    });
  }
}
