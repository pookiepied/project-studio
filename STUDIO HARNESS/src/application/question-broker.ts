import type { AuthContext } from "../admission/context.js";
import { createStudioUuid } from "../identity/uuid.js";
import type {
  PendingQuestionStore,
  StoredQuestion,
} from "../questions/pending-questions.js";
import type {
  QuestionAnswer,
  QuestionOutcome,
  QuestionPayload,
  QuestionReport,
} from "../questions/question.js";

/**
 * The channel a run's question travels on.
 *
 * The local half and the durable half, kept in step the same way the approval
 * broker keeps them: the row is written before the caller parks, so a crash
 * answers "the question still exists" rather than "nothing happened". The
 * promise cannot survive the process; the row does, and the UI reads the
 * store - the source of truth precisely because it outlives a restart.
 *
 * This is not the approval channel wearing different clothes. A permission
 * question resolves to allow or deny and can never take a default; this
 * channel resolves to an answer, a deferral, a stop, or a timeout that takes
 * only what the model itself offered up front. The separation is the point -
 * see the store, which shares no table with `pending_approval`.
 */

/** One question still waiting, as the UI renders it. */
export interface PendingQuestionView {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: number;
  /** The stored deadline, or null when this question parks indefinitely. */
  readonly expiresAt: number | null;
  readonly payload: QuestionPayload;
}

/** What a person sent back, from the HTTP surface. */
export interface QuestionReply {
  /** Chosen option ids, for an answered question. */
  readonly optionIds?: readonly string[];
  /** What the person wrote, when they answered in their own words. */
  readonly text?: string;
  /** True when the person is declining to choose and wants the model to decide. */
  readonly deferred: boolean;
}

/** One question of a parked call, and what came of it. */
interface CallSlot {
  readonly rowId: string;
  readonly payload: QuestionPayload;
  outcome: QuestionOutcome | undefined;
  answer?: QuestionAnswer;
}

/**
 * One parked call: one to four questions asked together, resolved when the
 * last of them settles. The slots and the live waiter are held together so
 * an answer to any one question can tell whether the call is finished.
 */
interface ParkedCall {
  readonly conversationId: string;
  readonly slots: CallSlot[];
  readonly resolve: (reports: readonly QuestionReport[]) => void;
  readonly cleanup: () => void;
}

export interface QuestionBrokerOptions {
  /**
   * Where pending questions are recorded.
   *
   * Optional only so a unit test can exercise the in-process half alone. The
   * server always supplies one: without it a restart loses every unanswered
   * question and the person is never asked again (ADR 0036).
   */
  readonly store?: PendingQuestionStore;
}

export class QuestionBroker {
  /** The calls this process is waiting on, by their questions' row ids. */
  readonly #rowToCall = new Map<string, { call: ParkedCall; at: number }>();
  /**
   * The questions this process asked, live in memory beside the durable rows.
   *
   * The store is the durable authority; this is what makes the broker work
   * with no store at all (a unit test's in-process half) and what gives an
   * answer its payload context without a round trip.
   */
  readonly #asked = new Map<string, StoredQuestion>();
  readonly #store: PendingQuestionStore | undefined;

  constructor(options: QuestionBrokerOptions = {}) {
    this.#store = options.store;
  }

  /**
   * Asks, and parks until every question in the call has settled.
   *
   * Resolving to `undefined` means the call was torn down with its run - the
   * person pressed stop at the composer, or the submission died under the
   * question. The rows are left standing either way: an unanswered question
   * does not stop existing because the process holding it went down.
   */
  ask(
    conversationId: string,
    questions: readonly QuestionPayload[],
    timeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<readonly QuestionReport[] | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);

    const askedAt = Date.now();
    const expiresAt = timeoutMs === undefined ? null : askedAt + timeoutMs;
    const slots: CallSlot[] = questions.map((payload) => ({
      rowId: "",
      payload,
      outcome: undefined,
    }));

    return new Promise((resolve) => {
      const onAbort = (): void => {
        // The in-memory half goes; the durable half stays. The run that asked
        // is gone either way, and the question remains something a person can
        // still see and answer.
        this.#dropCall(call);
        resolve(undefined);
      };
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);

      const call: ParkedCall = {
        conversationId,
        slots,
        resolve: (reports) => {
          cleanup();
          resolve(reports);
        },
        cleanup,
      };

      questions.forEach((payload, at) => {
        const id = createStudioUuid();
        // Recorded before the caller parks. The other order has a window in
        // which a crash loses a question that was already being waited on.
        const row: StoredQuestion = {
          id,
          conversationId,
          payload,
          askedAt,
          expiresAt,
          outcome: undefined,
          answer: undefined,
        };
        this.#store?.add(row);
        this.#asked.set(id, row);
        slots[at] = { rowId: id, payload, outcome: undefined };
        this.#rowToCall.set(id, { call, at });
      });

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Every question still waiting, including ones inherited from a previous
   * process.
   *
   * This read is also where expiry is honoured. The deadline is the stored
   * row's, never a timer, so whoever picks the row up next - a poll, an
   * answer, a stop - can see that it has passed and act on it.
   */
  list(_auth: AuthContext): readonly PendingQuestionView[] {
    this.#settleExpired();
    return this.#pending().map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      createdAt: row.askedAt,
      expiresAt: row.expiresAt,
      payload: row.payload,
    }));
  }

  /**
   * Settles one question with a choice, a free-text answer, or a deferral.
   *
   * True means the question was open and is now closed - including when this
   * process inherited the row from a dead one and there is no waiter left to
   * wake. False means there was nothing to settle, which is what a double
   * answer or a race with another window looks like.
   */
  answer(id: string, reply: QuestionReply, _auth: AuthContext): boolean {
    this.#settleExpired();
    const row = this.#row(id);
    if (row === undefined) return false;

    // `get` reads by id and returns settled rows too, because a settled row
    // is the record of a decision. So the pending check belongs here rather
    // than in the store. Without it a second answer reports success: both
    // windows of a race are told theirs was the answer taken, and a person
    // whose question expired a moment ago is told their late choice landed
    // when the recommendation is what the model actually received.
    if (row.outcome !== undefined) return false;

    const answer = deferredOrAnswer(row, reply);
    if (answer === undefined) return false;

    return this.#settleRow(row, reply.deferred ? "deferred" : "answered", answer);
  }

  /**
   * Stops every question one conversation is asking: the person is present
   * and ending the run.
   *
   * Each stopped row is settled as a real outcome, not deleted - the record
   * of the stop is what makes the closing turn honest. Returns how many
   * questions were stopped, so a caller can tell a stop from a no-op.
   */
  stop(conversationId: string, _auth: AuthContext): number {
    this.#settleExpired();
    let stopped = 0;
    for (const row of this.#pending()) {
      if (row.conversationId !== conversationId) continue;
      if (this.#settleRow(row, "stopped", undefined)) stopped += 1;
    }
    return stopped;
  }

  /**
   * Withdraws one question without an outcome: what an aborted run does to
   * its own outstanding questions.
   *
   * The row goes; the parked call's slot is closed as a stop so the call
   * cannot hang waiting for a question that no longer exists.
   *
   * Only a pending row can be withdrawn. A settled one is a decision that was
   * actually made, and deleting it is the one thing this must never do: a
   * stale cancel arriving from a closing window would erase the record of an
   * answer the person gave.
   */
  cancel(id: string, _auth: AuthContext): boolean {
    this.#settleExpired();
    const row = this.#row(id);
    if (row === undefined) return false;
    if (row.outcome !== undefined) return false;

    this.#store?.remove(id);
    this.#asked.delete(id);
    this.#closeSlot(row.id, "stopped", undefined);
    return true;
  }

  /** The store when there is one; the live half alone when there is not. */
  #pending(): readonly StoredQuestion[] {
    if (this.#store !== undefined) return this.#store.list();
    return [...this.#asked.values()]
      .filter((row) => row.outcome === undefined)
      .sort((left, right) => left.askedAt - right.askedAt);
  }

  #row(id: string): StoredQuestion | undefined {
    return this.#store?.get(id) ?? this.#asked.get(id);
  }

  /**
   * Closes one question, and resolves its call when the last question closes.
   *
   * A row with no live slot is one this process inherited: the run that was
   * waiting on it is gone, but the question is genuinely settled and must
   * leave the queue. Reporting `false` there would make the UI show a
   * question it had just actioned.
   */
  #settleRow(
    row: StoredQuestion,
    outcome: QuestionOutcome,
    answer: QuestionAnswer | undefined,
  ): boolean {
    this.#store?.settle(row.id, outcome, answer);
    const live = this.#asked.get(row.id);
    if (live !== undefined) {
      this.#asked.set(row.id, { ...live, outcome, ...(answer === undefined ? {} : { answer }) });
    }
    this.#closeSlot(row.id, outcome, answer);
    return true;
  }

  #closeSlot(rowId: string, outcome: QuestionOutcome, answer: QuestionAnswer | undefined): boolean {
    const parked = this.#rowToCall.get(rowId);
    if (parked === undefined) return true;

    const slot = parked.call.slots[parked.at];
    if (slot === undefined) return true;
    slot.outcome = outcome;
    if (answer !== undefined) slot.answer = answer;
    if (parked.call.slots.some((entry) => entry.outcome === undefined)) return true;

    this.#dropCall(parked.call);
    parked.call.resolve(parked.call.slots.map((entry) => reportFor(entry)));
    return true;
  }

  #dropCall(call: ParkedCall): void {
    for (const slot of call.slots) {
      if (slot.rowId !== "") this.#rowToCall.delete(slot.rowId);
    }
    call.cleanup();
  }

  /**
   * Settles every question whose stored deadline has passed.
   *
   * An expired question with a recommendation resolves to it - that is what
   * the recommendation was for. An expired question without one stays
   * pending: it does not resolve, and it does not disappear. There is no
   * timer anywhere; this runs at the top of every read and write, so the
   * same pass governs the live process and a process that has just picked
   * the rows up after a restart.
   */
  #settleExpired(): void {
    const now = Date.now();
    for (const row of this.#pending()) {
      if (row.expiresAt === null || row.expiresAt > now) continue;
      const recommended = row.payload.recommendedOptionId;
      if (recommended === undefined) continue;
      this.#settleRow(row, "timed_out", { optionIds: [recommended] });
    }
  }
}

/**
 * The answer a question takes, from what the person sent.
 *
 * Returns `undefined` for a reply that names an option the question never
 * offered, that offers several where one was asked for, or that is empty -
 * the approver's rule, on the ask side: an answer is chosen from what was
 * shown, and free text is always allowed but never invented here.
 */
function deferredOrAnswer(
  row: StoredQuestion,
  reply: QuestionReply,
): QuestionAnswer | undefined {
  if (reply.deferred) return {};

  const offered = new Set(row.payload.options.map((option) => option.id));
  if (reply.optionIds !== undefined) {
    if (reply.optionIds.length === 0) return undefined;
    if (!row.payload.multiSelect && reply.optionIds.length > 1) return undefined;
    if (reply.optionIds.some((optionId) => !offered.has(optionId))) return undefined;
    return { optionIds: [...reply.optionIds] };
  }
  if (reply.text !== undefined && reply.text.trim() !== "") {
    return { text: reply.text };
  }
  return undefined;
}

/** The model-facing word for how one question came out. */
function reportFor(slot: CallSlot): QuestionReport {
  const labels = (slot.answer?.optionIds ?? []).map((optionId) => {
    const option = slot.payload.options.find((entry) => entry.id === optionId);
    return option?.label ?? optionId;
  });
  return {
    header: slot.payload.header,
    question: slot.payload.question,
    outcome: slot.outcome ?? "stopped",
    ...(slot.answer?.optionIds === undefined ? {} : { optionIds: slot.answer.optionIds }),
    ...(labels.length > 0 ? { labels } : {}),
    ...(slot.answer?.text === undefined ? {} : { text: slot.answer.text }),
  };
}
