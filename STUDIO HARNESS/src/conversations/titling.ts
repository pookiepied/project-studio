import { dispatch, observe, type FlueObservation } from "@flue/runtime";

import { Title } from "../agents/title.js";
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
 * A whole reply that is one markdown code fence, and nothing else.
 *
 * The capture is the fenced body; an optional language tag on the opening
 * line is dropped. Anchored at both ends on purpose - a fence with prose
 * before or after it does not match, and stays a refusal.
 */
const FENCED_REPLY = /^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

/**
 * The one formatting envelope the parse forgives.
 *
 * The prompt asks for a bare JSON object and says not to use markdown, and
 * models fence it anyway - measured, in the real app: a live titling run on
 * `google/gemma-4-26b-a4b-it` answered with exactly the object the contract
 * asks for, wrapped in a ```json fence, and `JSON.parse` refused the whole
 * thing. The derived title stood and the person saw eight words of their own
 * message.
 *
 * That is worth forgiving rather than out-prompting, because the model layer
 * deliberately sends titling to the CHEAPEST reachable model, and fencing
 * JSON is exactly what small instruction-tuned models do. Refusing it makes
 * the cost policy and the feature mutually exclusive.
 *
 * Nothing else is forgiven. Prose around the object, a fence with text
 * outside it, a second field, a bare string - all still refusals.
 */
function unfenceReply(reply: string): string {
  const fenced = FENCED_REPLY.exec(reply.trim());
  return fenced?.[1] ?? reply;
}

/**
 * Parses a titling reply into a title, and refuses everything else.
 *
 * The contract with the agent is one JSON object with one string field -
 * exactly that, so a reply that wraps the object in prose, returns a bare
 * string, adds a second field, or spills a list is a failure, and a failure
 * keeps the derived title. The same gate rejects a title that is empty, one
 * that carries a line break, or one long enough to stop being a session-list
 * row. A reply that is nothing but a markdown code fence is unwrapped first;
 * see `unfenceReply` for why that one envelope is allowed and no other.
 *
 * Returns undefined for every refusal; the caller logs and moves on.
 */
export function titleFromReply(reply: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenceReply(reply));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  // Typed at the source: `Object.entries` hands back `any` values, and a
  // pair destructured from that carries the `any` no matter what the
  // destructuring says it is.
  const entries: [string, unknown][] = Object.entries(parsed);
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

/**
 * What one title run answered: the text to parse, and the model that wrote
 * it.
 */
interface TitleReply {
  readonly text: string;
  /** `<provider>/<model>`, the `title_model` log fact. */
  readonly model: string;
}

/**
 * The final assistant reply of a title run, read off its `agent_end` event.
 *
 * Flue 2.0 observations carry the run's messages rather than a settled
 * result object, so the reply is the last assistant message's text content:
 * the one JSON object the prompt's contract asks for. Anything else - a
 * tool-call-only tail, an empty message - reads as no reply, and the caller
 * treats the settlement as unusable rather than guessing.
 *
 * The same message is where the model identity comes from, and it is the
 * only channel that still carries one. 2.0 stamps no model into message
 * metadata, the history projection drops it, and neither `message-started`
 * nor `message-completed` carries it on the wire (Phase 6 measured all
 * three). The observation's assistant message does: `provider` and `model`
 * are required fields on it, with `responseModel` naming what actually
 * answered when a router served something other than what was asked for.
 * That is what restores `title_model` - which model spent the money on
 * eight words is the whole reason the ladder exists, and a log line nobody
 * can check is a policy nobody can audit.
 */
function lastAssistantReply(
  messages: Extract<FlueObservation, { type: "agent_end" }>["messages"],
): TitleReply | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "assistant") continue;
    const parts = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text);
    const text = parts.join("");
    if (text.trim() === "") return undefined;
    return {
      text,
      model: `${message.provider}/${message.responseModel ?? message.model}`,
    };
  }
  return undefined;
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
 * - **The trigger** is the studio agent's submission for the conversation
 *   settling `completed` (a `submission_settled` event naming agent
 *   `studio`). Admission is too early: a turn that is refused or dies would
 *   have spent a model call on an exchange that never happened. The settled
 *   submission is the runtime's stable contract for "this exchange
 *   finished". Measured against a live 2.0 trace in Phase 7; the envelopes
 *   are quoted at `#onObservation`.
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
  /**
   * Replies captured off each title run's `agent_end`, keyed by the run's
   * instance id and consumed by that run's settlement. Bounded the same way
   * as `pending`: an entry lives only until its submission settles.
   */
  readonly #titleReplies = new Map<string, TitleReply>();
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
        // Flue 2.0 dispatches by agent reference, not by name string, and
        // takes the message as a delivered input (a bare string is shorthand
        // for a user message). The receipt's submissionId is not read: the
        // run's own events carry it, and this orchestrator routes on the
        // instance id, which it already knows.
        //
        // `dispatch` resolves its target by FUNCTION VALUE, not by name, so
        // this import has to be the same module object the build registered
        // as the `title` agent. On Windows it was not, until Phase 7:
        // `@flue/vite`'s scanned-agent module imported the file under a
        // second spelling of its path, the bundle carried two copies, and
        // every dispatch was refused with "target agent is not registered in
        // this built application". The fix is a resolver plugin in
        // `vite.config.ts`; the reason it belongs there rather than here is
        // written next to it.
        await dispatch(Title, { id: instanceId, message });
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

  /**
   * Routes a live observation onto the jobs it concerns.
   *
   * Flue 2.0 vocabulary, mapped onto the same semantics the 1.0 operation
   * events carried:
   *
   * - The studio trigger is the conversation's own submission settling
   *   `completed` (`submission_settled`, agent `studio`). Admission is too
   *   early: a turn that is refused or dies would have spent a model call on
   *   an exchange that never happened. The settled submission is the
   *   runtime's stable contract for "this exchange finished".
   * - The title agent's reply rides the run's `agent_end` event, whose
   *   `messages` carry the final assistant text - the JSON the contract
   *   asks for. It is captured here and consumed by the submission's
   *   settlement below (`agent_end` fires before `submission_settled`).
   * - A title run that settled `failed` or `aborted` steps one rung down
   *   the ladder (`submission_settled`), exactly as an errored operation
   *   did.
   *
   * ---- The envelopes, measured (Phase 7, live 2.0 harness) ---------------
   *
   * A direct submission on the studio agent and a dispatched title run stamp
   * the SAME envelope fields; only `kind` on the queued/running events tells
   * them apart (`"direct"` against `"dispatch"`). Verbatim:
   *
   * ```
   * {"type":"submission_settled","submissionId":"sub_01M1HW0KKR456ZA82Y4H8HW2DH",
   *  "outcome":"completed","instanceId":"cnv_2480bd27-...","agentName":"studio",
   *  "v":3,"eventIndex":14,"timestamp":"2026-09-02T20:12:22.709Z"}
   *
   * {"type":"agent_end","messages":[...],"conversationId":"conv_01M1HW0KT16Q1E18JY5TWWM3D9",
   *  "session":"default","operationId":"op_01M1HW0KT99J5NMBNSWZAJH7W6",
   *  "harness":"default","instanceId":"cnv_2480bd27-...",
   *  "submissionId":"sub_01M1HW0KST0CFMR1EZKB8RTHZZ","agentName":"title",
   *  "v":3,"eventIndex":11,"timestamp":"2026-09-02T20:12:22.748Z"}
   * ```
   *
   * Three things the trace settled, all of them assumptions until it ran:
   *
   * - **`agent_end` really does precede `submission_settled`** - eventIndex
   *   11 against 14, with `operation`, `idle` and the settlement between
   *   them. The stash is read after it is written, which is what this
   *   routing depends on.
   * - **`submission_settled` carries `instanceId` and `agentName` and
   *   nothing else of the run** - no `conversationId`, no `session`, no
   *   `harness`, no `operationId`. The two fields routed on here are exactly
   *   the two that are there.
   * - **`instanceId` is OUR id and `conversationId` is Flue's.** The
   *   instance id is the conversation id the webview minted (`cnv_<uuid>`,
   *   or `<id>-t<N>` for a title retry); `conversationId` is a
   *   runtime-minted `conv_<ulid>` naming the durable stream, and it is not
   *   the product's conversation. Routing on `conversationId` would name the
   *   wrong thing.
   */
  #onObservation(observation: FlueObservation): void {
    const instanceId = observation.instanceId;
    if (typeof instanceId !== "string" || instanceId === "") return;

    if (observation.agentName === STUDIO_AGENT_ID) {
      if (
        observation.type === "submission_settled" &&
        observation.outcome === "completed"
      ) {
        this.#studioExchangeSettled(instanceId);
      }
      return;
    }
    if (observation.agentName !== TITLE_AGENT_ID) return;

    if (observation.type === "agent_end") {
      const reply = lastAssistantReply(observation.messages);
      if (reply !== undefined) this.#rememberTitleReply(instanceId, reply);
      return;
    }
    if (observation.type !== "submission_settled") return;
    if (observation.outcome === "completed") {
      const reply = this.#takeTitleReply(instanceId);
      if (reply === undefined) {
        // The submission settled without a reply this process captured -
        // a recovery replay or a run whose end event was never observed.
        // Nothing usable to parse; the job ends and the derived title
        // stands.
        this.#logger?.warn("Conversation titling settled without a captured reply.", {
          conversation_id: conversationIdOf(instanceId),
        });
        this.#inFlight.delete(conversationIdOf(instanceId));
        return;
      }
      this.#titleReplySettled(instanceId, reply);
      return;
    }
    this.#forgetTitleReply(instanceId);
    this.#titleAttemptFailed(instanceId);
  }

  #studioExchangeSettled(conversationId: string): void {    const message = this.#pending.get(conversationId);
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

  #rememberTitleReply(instanceId: string, reply: TitleReply): void {
    if (this.#titleReplies.size >= MAX_PENDING) {
      const oldest = this.#titleReplies.keys().next();
      if (!oldest.done) this.#titleReplies.delete(oldest.value);
    }
    this.#titleReplies.set(instanceId, reply);
  }

  /** Consumes one captured reply; a second read finds nothing. */
  #takeTitleReply(instanceId: string): TitleReply | undefined {
    const reply = this.#titleReplies.get(instanceId);
    this.#titleReplies.delete(instanceId);
    return reply;
  }

  #forgetTitleReply(instanceId: string): void {
    this.#titleReplies.delete(instanceId);
  }

  #titleReplySettled(instanceId: string, reply: TitleReply): void {
    const conversationId = conversationIdOf(instanceId);
    const title = titleFromReply(reply.text);
    if (title === undefined) {
      // The model answered but not in the contract's shape. Stepping down
      // the ladder cannot fix a model that will not follow the prompt; the
      // derived title stands. The model is named here too: a model that
      // will not produce the one object the prompt asks for is a rung of
      // the ladder worth knowing about.
      this.#logger?.warn("Conversation titling reply was not a usable title.", {
        conversation_id: conversationId,
        title_model: reply.model,
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
    this.#logger?.info("Conversation titled.", {
      conversation_id: conversationId,
      title_model: reply.model,
    });
  }
}
