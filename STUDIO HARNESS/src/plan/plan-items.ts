import type { StudioDatabase } from "../storage/database.js";
import { StorageError } from "../storage/errors.js";
import {
  PLAN_STATUSES,
  type PlanItemWrite,
  type PlanStatus,
  type PlanView,
  type PlanWriter,
  type StoredPlanItem,
} from "./plan.js";

/**
 * The durable half of the plan: the rows a run writes and a person ticks.
 *
 * The plan belongs to the conversation, not to the run that happened to write
 * it - no run id, no turn id, no expiry, no archived flag. A second run in the
 * same conversation continues the same list, which is the whole requirement
 * the table is shaped for.
 *
 * The two decisions that give the table its meaning:
 *
 * - **Writes merge by id.** A write changes only the items it names; every
 *   other row keeps whatever state it has, including a tick the person gave it
 *   a moment before the model composed its call. Replacing the list wholesale
 *   is the lost-update race this store exists to refuse, so the primitive is
 *   an upsert per named item and there is no replace.
 * - **`position` is assigned when an item is first seen and never
 *   recomputed.** Ordering the panel by anything derived makes the list jump
 *   under the reader's eyes every time something completes; ordering by
 *   first-seen position keeps it still. A merge that touches item three does
 *   not move items one and two.
 *
 * Nothing here holds a secret. A row is a sentence and a status.
 */
export class PlanItemStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * Merges the named items into the conversation's plan, then returns the
   * whole plan as it now stands.
   *
   * `writer` is recorded per touched row, so the next reader - the model in
   * its own next result, the panel, another window - can tell a model's
   * status from a person's tick.
   */
  merge(
    conversationId: string,
    writes: readonly PlanItemWrite[],
    writer: PlanWriter,
  ): PlanView {
    // The whole batch is checked before any of it is written: a call with one
    // bad item must not become a half-applied merge.
    for (const write of writes) {
      assertWritable(write);
    }
    const known = new Set(
      (
        this.#db
          .prepare("SELECT id FROM plan_item WHERE conversation_id = ?")
          .all(conversationId) as unknown as { id: string }[]
      ).map((row) => row.id),
    );
    const highest = this.#db
      .prepare("SELECT MAX(position) AS position FROM plan_item WHERE conversation_id = ?")
      .get(conversationId) as unknown as { position: number | null };
    let nextPosition = highest.position ?? 0;

    for (const write of writes) {
      if (known.has(write.id)) {
        // Position is deliberately untouched: first-seen order is the stable
        // order, and an update is not a re-entry.
        this.#db
          .prepare(
            `UPDATE plan_item
               SET text = ?, status = ?, updated_by = ?, updated_at = ?
             WHERE conversation_id = ? AND id = ?`,
          )
          .run(
            write.text,
            write.status,
            writer,
            Date.now(),
            conversationId,
            write.id,
          );
        continue;
      }
      known.add(write.id);
      nextPosition += 1;
      this.#db
        .prepare(
          `INSERT INTO plan_item
             (conversation_id, id, text, status, position, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          conversationId,
          write.id,
          write.text,
          write.status,
          nextPosition,
          writer,
          Date.now(),
        );
    }

    return this.list(conversationId);
  }

  /**
   * Sets one existing item's status, and only an existing item's.
   *
   * This is the person's primitive, and it is not a merge on purpose: a tick
   * names an item that is already on the list, and writing a missing one into
   * existence would let a stray id invent plan items nobody planned. False
   * means there was no such item.
   */
  update(
    conversationId: string,
    itemId: string,
    // `string`, not `PlanStatus`: the guard below is the whole point of this
    // parameter, and it can only be reached by a value that has not been
    // checked yet. Declaring the narrow type made the check dead code as far
    // as the compiler was concerned while a test proved it still fires.
    status: string,
    writer: PlanWriter,
  ): boolean {
    if (!isStatus(status)) {
      throw new StorageError("invalid", {
        message: `"${status}" is not a status a plan item can take.`,
      });
    }
    const result = this.#db
      .prepare(
        `UPDATE plan_item
           SET status = ?, updated_by = ?, updated_at = ?
         WHERE conversation_id = ? AND id = ?`,
      )
      .run(status, writer, Date.now(), conversationId, itemId);
    return Number(result.changes) > 0;
  }

  /**
   * One conversation's plan, in position order.
   *
   * A row that cannot be trusted - a status outside the five, a writer
   * outside the vocabulary (model, person, `agent:<name>`), a value that is
   * not what its column declares - makes the whole plan `damaged` rather
   * than crashing the reader or showing an empty list. An empty plan and an
   * unreadable plan are different facts, and a person acting on the wrong
   * one loses work.
   */
  list(conversationId: string): PlanView {
    const rows = this.#db
      .prepare(
        `SELECT conversation_id, id, text, status, position, updated_by, updated_at
           FROM plan_item WHERE conversation_id = ? ORDER BY position`,
      )
      .all(conversationId) as unknown as Row[];

    const items: StoredPlanItem[] = [];
    for (const row of rows) {
      const item = readRow(row);
      if (item === undefined) {
        return { conversationId, items: [], damaged: true };
      }
      items.push(item);
    }
    return { conversationId, items, damaged: false };
  }

  /** Removes every plan row for one conversation. What a purge calls. */
  clearConversation(conversationId: string): number {
    return Number(
      this.#db
        .prepare("DELETE FROM plan_item WHERE conversation_id = ?")
        .run(conversationId).changes,
    );
  }

  /**
   * Carries one conversation's plan to a fork, item for item.
   *
   * Positions travel unchanged, so the fork's panel reads exactly as the
   * source's did: first-seen order is the stable order, and renumbering
   * would reorder a plan nobody asked to reorder. Called only from
   * `conversations/fork.ts`, after the fork's index row.
   */
  duplicateConversation(sourceId: string, targetId: string): number {
    const result = this.#db
      .prepare(
        `INSERT INTO plan_item
           (conversation_id, id, text, status, position, updated_by, updated_at)
         SELECT ?, id, text, status, position, updated_by, updated_at
           FROM plan_item
          WHERE conversation_id = ?`,
      )
      .run(targetId, sourceId);

    return Number(result.changes);
  }
}

interface Row {
  conversation_id: string;
  id: string;
  text: string;
  status: string;
  position: number;
  updated_by: string;
  updated_at: number;
}

const STATUS_BY_TEXT: ReadonlyMap<string, PlanStatus> = new Map(
  PLAN_STATUSES.map((status) => [status, status]),
);

/**
 * The read-side parser for the writer dimension — the one place the
 * vocabulary is enforced. `model` and `person` are exact; a delegate's
 * write is stored as `agent:<agentName>` and parses only when the name is
 * non-empty, so a truncated or malformed value cannot masquerade as a
 * writer. Anything else is a row the plan cannot vouch for (`damaged`),
 * not a writer to guess at.
 */
function parseWriter(value: string): PlanWriter | undefined {
  if (value === "model" || value === "person") return value;
  if (value.startsWith("agent:")) {
    const agentName = value.slice("agent:".length);
    return agentName.trim() === "" ? undefined : (value as `agent:${string}`);
  }
  return undefined;
}

function isStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && STATUS_BY_TEXT.has(value);
}

/**
 * The write-side wall beside the read-side one.
 *
 * The tool's parse checks the same things, and a caller that skipped it still
 * meets this: the vocabulary is enforced at the store rather than trusted of
 * every future caller, which is the same reason the read refuses an unknown
 * status instead of rendering it.
 */
function assertWritable(write: PlanItemWrite): void {
  if (typeof write.id !== "string" || write.id.trim() === "") {
    throw new StorageError("invalid", {
      message: "A plan item needs an id.",
    });
  }
  if (typeof write.text !== "string" || write.text.trim() === "") {
    throw new StorageError("invalid", {
      message: `The plan item "${write.id}" needs its sentence.`,
    });
  }
  if (!isStatus(write.status)) {
    throw new StorageError("invalid", {
      message: `"${String(write.status)}" is not a status a plan item can take.`,
    });
  }
}

function readRow(row: Row): StoredPlanItem | undefined {
  const status = STATUS_BY_TEXT.get(row.status);
  const writer = parseWriter(row.updated_by);
  if (
    status === undefined ||
    writer === undefined ||
    typeof row.id !== "string" ||
    typeof row.text !== "string" ||
    typeof row.position !== "number" ||
    typeof row.updated_at !== "number"
  ) {
    return undefined;
  }
  return {
    id: row.id,
    text: row.text,
    status,
    position: row.position,
    updatedBy: writer,
    updatedAt: row.updated_at,
  };
}
