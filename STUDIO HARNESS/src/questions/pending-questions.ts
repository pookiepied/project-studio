import type { StudioDatabase } from "../storage/database.js";
import { StorageError } from "../storage/errors.js";
import type {
  QuestionAnswer,
  QuestionOutcome,
  QuestionOption,
  QuestionPayload,
} from "./question.js";

/**
 * The durable half of the question queue.
 *
 * A question a run puts to the person is a decision the system is waiting on,
 * and ADR 0036 makes those durable: the row is written before the caller
 * parks, so the question survives a restart and is asked again rather than
 * silently never asked. The *promise* the tool is waiting on cannot survive -
 * that run is gone - but the question can, and a card the UI still renders
 * after a crash is the difference between "re-ask me" and "nothing happened
 * and nobody knows why".
 *
 * This table is deliberately not `pending_approval`. A permission question
 * must never expire and must never have a default answer, because for a
 * permission the absence of an answer must never become consent. A product
 * question has a deadline and a recommended option. Sharing rows or code
 * between the two would put one bug away from converting the second
 * guarantee into the first, so nothing here is shared with the approval
 * store except the database handle and the shape of the idea.
 *
 * Nothing here holds a secret. The payload names a question and its options.
 */

export interface StoredQuestion {
  readonly id: string;
  readonly conversationId: string;
  readonly payload: QuestionPayload;
  readonly askedAt: number;
  /**
   * The stored deadline, or null when the question parks indefinitely.
   *
   * Stored, never a timer: whoever picks the row up next - the same process,
   * or a new one after a restart - reads this and can see it has already
   * passed. The clock on the wall does not own the decision; the row does.
   */
  readonly expiresAt: number | null;
  /** Absent while the question waits; one of the four outcomes once settled. */
  readonly outcome: QuestionOutcome | undefined;
  /** What was chosen, recorded the moment it was chosen. */
  readonly answer: QuestionAnswer | undefined;
}

interface Row {
  id: string;
  conversation_id: string;
  payload: string;
  asked_at: number;
  expires_at: number | null;
  outcome: string | null;
  answer: string | null;
}

export class PendingQuestionStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /** Records the question before the asker parks on it. */
  add(question: StoredQuestion): void {
    this.#db
      .prepare(
        `INSERT INTO pending_question
           (id, conversation_id, payload, asked_at, expires_at, outcome, answer)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        question.id,
        question.conversationId,
        JSON.stringify(question.payload),
        question.askedAt,
        question.expiresAt,
        question.outcome ?? null,
        question.answer === undefined ? null : JSON.stringify(question.answer),
      );
  }

  /** Closes one question with an outcome and, for an answer, the choice. */
  settle(id: string, outcome: QuestionOutcome, answer: QuestionAnswer | undefined): void {
    this.#db
      .prepare(
        "UPDATE pending_question SET outcome = ?, answer = ? WHERE id = ? AND outcome IS NULL",
      )
      .run(outcome, answer === undefined ? null : JSON.stringify(answer), id);
  }

  remove(id: string): void {
    this.#db.prepare("DELETE FROM pending_question WHERE id = ?").run(id);
  }

  get(id: string): StoredQuestion | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, conversation_id, payload, asked_at, expires_at, outcome, answer
           FROM pending_question WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    return row === undefined ? undefined : readRow(row);
  }

  /** Every question still waiting, oldest first: the person answers what has waited longest. */
  list(): readonly StoredQuestion[] {
    const rows = this.#db
      .prepare(
        `SELECT id, conversation_id, payload, asked_at, expires_at, outcome, answer
           FROM pending_question WHERE outcome IS NULL ORDER BY asked_at`,
      )
      .all() as unknown as Row[];
    return rows.map(readRow);
  }
}

const OUTCOME_BY_TEXT: ReadonlyMap<string, QuestionOutcome> = new Map([
  ["answered", "answered"],
  ["deferred", "deferred"],
  ["stopped", "stopped"],
  ["timed_out", "timed_out"],
]);

function readRow(row: Row): StoredQuestion {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    payload: readPayload(row.payload, row.id),
    askedAt: row.asked_at,
    expiresAt: row.expires_at,
    outcome: row.outcome === null ? undefined : readOutcome(row.outcome, row.id),
    answer: row.answer === null ? undefined : readAnswer(row.answer, row.id),
  };
}

function readOutcome(raw: string, id: string): QuestionOutcome {
  const outcome = OUTCOME_BY_TEXT.get(raw);
  if (outcome === undefined) throw unreadable(id);
  return outcome;
}

function readPayload(raw: string, id: string): QuestionPayload {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw unreadable(id);

  const question = value["question"];
  const header = value["header"];
  const multiSelect = value["multiSelect"];
  const recommended = value["recommendedOptionId"];
  if (
    typeof question !== "string" ||
    typeof header !== "string" ||
    typeof multiSelect !== "boolean" ||
    !Array.isArray(value["options"]) ||
    (recommended !== undefined && typeof recommended !== "string")
  ) {
    throw unreadable(id);
  }

  const options: QuestionOption[] = [];
  for (const entry of value["options"]) {
    if (!isRecord(entry)) throw unreadable(id);
    const optionId = entry["id"];
    const label = entry["label"];
    const description = entry["description"];
    if (
      typeof optionId !== "string" ||
      typeof label !== "string" ||
      typeof description !== "string"
    ) {
      throw unreadable(id);
    }
    options.push({ id: optionId, label, description });
  }

  return {
    question,
    header,
    options,
    multiSelect,
    ...(recommended === undefined ? {} : { recommendedOptionId: recommended }),
  };
}

function readAnswer(raw: string, id: string): QuestionAnswer {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw unreadable(id);

  const optionIds = value["optionIds"];
  const text = value["text"];
  const optionsValid =
    optionIds === undefined ||
    (Array.isArray(optionIds) && optionIds.every((entry) => typeof entry === "string"));
  if (!optionsValid || (text !== undefined && typeof text !== "string")) {
    throw unreadable(id);
  }

  return {
    ...(Array.isArray(optionIds) ? { optionIds: optionIds.map(String) } : {}),
    ...(typeof text === "string" ? { text } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unreadable(id: string): StorageError {
  return new StorageError("invalid", {
    message: `The stored question "${id}" is unreadable.`,
  });
}
