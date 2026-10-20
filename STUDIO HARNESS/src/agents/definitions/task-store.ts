import { agentRegistry } from "./index.js";
import { AgentRegistryError, type RegisteredAgent } from "./registry.js";
import {
  isSettledTaskStatus,
  type AgentTaskStatus,
} from "../../contracts/agents.js";
import type { StudioDatabase } from "../../storage/database.js";
import { storageErrorFrom } from "../../storage/errors.js";

/**
 * The index of background agent tasks (ADR 0058 D5, Stage 2: the store, no
 * routes).
 *
 * What this store is for: a row per dispatched agent task, so the rail's
 * future Tasks section and the settlement projector have a place to read and
 * write status. What it is NOT, and deliberately: a transcript (Flue's
 * stream is canonical; no row holds a message or an answer body), a
 * scheduler (nothing here dispatches or retries - ADR 0033's rule), or a
 * queue (the dispatch happens in the caller; the row records it).
 *
 * Rows are written by the same code that dispatches - Stage 4's dispatcher
 * and the observer-seam projector. Until those land this store has no
 * production writer, which is the honest Stage 2 shape: the schema exists
 * ahead of the feature that needs it, exactly as migration 14's `model_id`
 * column did.
 */

/** One row of the task index. */
export interface AgentTaskRecord {
  /** The task's Flue instance id, minted by the dispatching side. */
  readonly id: string;
  /** The definition's pinned `agentName`. */
  readonly agentName: string;
  readonly parentConversationId: string | undefined;
  readonly originSubmissionId: string | undefined;
  readonly title: string;
  readonly status: AgentTaskStatus;
  readonly createdAt: number;
  readonly settledAt: number | undefined;
  /**
   * A pointer-shape sentence, never the answer: the task's own stream is
   * where the answer lives, and this column is what the rail row shows.
   */
  readonly resultSummary: string | undefined;
}

/** What the caller of `record` names for a task being dispatched. */
export interface AgentTaskInsertion {
  readonly id: string;
  readonly agentName: string;
  readonly parentConversationId?: string | undefined;
  readonly originSubmissionId?: string | undefined;
  readonly title?: string | undefined;
}

interface TaskRow {
  id: string;
  agent_name: string;
  parent_conversation_id: string | null;
  origin_submission_id: string | null;
  title: string;
  status: string;
  created_at: number;
  settled_at: number | null;
  result_summary: string | null;
}

const COLUMNS = `id, agent_name, parent_conversation_id, origin_submission_id,
                  title, status, created_at, settled_at, result_summary`;

/**
 * A stored status the reader cannot parse becomes `unknown` rather than a
 * thrown error: the row is an index, and a value this process does not
 * recognize is a state this process cannot prove - the honest answer, the
 * same one the settlement vocabulary gives a stream that ended without an
 * event anyone saw.
 */
function statusOf(stored: string): AgentTaskStatus {
  return AGENT_TASK_STATUSES.has(stored) ? (stored as AgentTaskStatus) : "unknown";
}

const AGENT_TASK_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);

function toRecord(row: TaskRow): AgentTaskRecord {
  return {
    id: row.id,
    agentName: row.agent_name,
    parentConversationId: row.parent_conversation_id ?? undefined,
    originSubmissionId: row.origin_submission_id ?? undefined,
    title: row.title,
    status: statusOf(row.status),
    createdAt: row.created_at,
    settledAt: row.settled_at ?? undefined,
    resultSummary: row.result_summary ?? undefined,
  };
}

export class TaskStore {
  readonly #db: StudioDatabase;
  readonly #settledListeners: (() => void)[] = [];

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * Records a task at dispatch time. The status starts at `running`, not
   * `queued`: Flue's dispatch admits the submission synchronously, so by the
   * time this row exists the run has been admitted - a `queued` status is a
   * scheduler's vocabulary, and nothing here schedules.
   */
  record(task: AgentTaskInsertion): AgentTaskRecord {
    const registered = agentRegistry.get(task.agentName);
    assertDispatchable(registered, task.agentName);
    const now = Date.now();
    try {
      this.#db
        .prepare(
          `INSERT INTO agent_task
                    (id, agent_name, parent_conversation_id, origin_submission_id,
                     title, status, created_at)
                  VALUES (?, ?, ?, ?, ?, 'running', ?)`,
        )
        .run(
          task.id,
          task.agentName,
          task.parentConversationId ?? null,
          task.originSubmissionId ?? null,
          task.title ?? defaultTitle(registered),
          now,
        );
    } catch (error) {
      throw storageErrorFrom(error);
    }
    // No defensive re-read with a fallback error: the insert either threw
    // above or committed this row, so this get cannot miss, and an
    // unreachable "impossible" throw is what the unclassified-error
    // architecture test refuses.
    return this.get(task.id) as AgentTaskRecord;
  }

  get(id: string): AgentTaskRecord | undefined {
    const row = this.#db
      .prepare(`SELECT ${COLUMNS} FROM agent_task WHERE id = ?`)
      .get(id) as unknown as TaskRow | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  /**
   * Links the row to the submission Flue minted for it, after the dispatch's
   * receipt comes back. Written only once and only while the column is empty:
   * the row is created before the dispatch (so a run that starts is always
   * indexed), which leaves a window where the row exists and the id does not,
   * and this is the one call that closes it. A row already carrying one is
   * left alone — a second write could only disagree with the first, and two
   * opinions about which submission a task was is exactly what the
   * execution-context graph must not hold.
   */
  setOriginSubmission(id: string, submissionId: string): void {
    try {
      this.#db
        .prepare(
          "UPDATE agent_task SET origin_submission_id = ? WHERE id = ? AND origin_submission_id IS NULL",
        )
        .run(submissionId, id);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * Every task, newest first, narrowed by the filters a rail will ask for.
   * Each filter is a conjunction on its column; an absent filter says
   * nothing about that column.
   */
  list(
    filters: {
      readonly agentName?: string;
      readonly parentConversationId?: string;
    } = {},
  ): readonly AgentTaskRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (filters.agentName !== undefined) {
      conditions.push("agent_name = ?");
      params.push(filters.agentName);
    }
    if (filters.parentConversationId !== undefined) {
      conditions.push("parent_conversation_id = ?");
      params.push(filters.parentConversationId);
    }
    const where =
      conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    // `rowid` breaks the same-millisecond tie, insertion order within it:
    // "newest first" is deterministic without asking the caller to sleep
    // between records, and a task rail that flickers between two tasks
    // dispatched in one millisecond is a bug nobody needs.
    const rows = this.#db
      .prepare(
        `SELECT ${COLUMNS} FROM agent_task ${where} ORDER BY created_at DESC, rowid DESC`,
      )
      .all(...params) as unknown as TaskRow[];
    return rows.map(toRecord);
  }

  /**
   * Sets a task's status. A settled status also stamps `settled_at` and the
   * summary sentence, idempotently: the projector may see the same
   * settlement twice (recovery replay), and the second write is the same
   * answer the first wrote.
   */
  /** Called after any task settles, which is when a running slot frees. */
  onSettled(listener: () => void): void {
    this.#settledListeners.push(listener);
  }

  setStatus(
    id: string,
    status: AgentTaskStatus,
    resultSummary?: string,
  ): boolean {
    const settled = isSettledTaskStatus(status);
    const result = this.#db
      .prepare(
        settled
          ? `UPDATE agent_task
                SET status = ?, settled_at = COALESCE(settled_at, ?),
                    result_summary = COALESCE(?, result_summary)
              WHERE id = ?`
          : `UPDATE agent_task SET status = ? WHERE id = ?`,
      )
      .run(
        ...(settled ? [status, Date.now(), resultSummary ?? null, id] : [status, id]),
      );
    const changed = Number(result.changes) > 0;
    if (changed && settled) {
      for (const listener of this.#settledListeners) {
        try { listener(); } catch { /* A listener's fault never undoes the settlement. */ }
      }
    }
    return changed;
  }

  /**
   * Destroys a task's row, for the conversation purge path. A purged
   * conversation takes its task rows the way it takes its grants: the
   * record goes with the thing it indexed, and the task's own stream goes
   * with the Flue purge path (flue-journal-delete.ts) — one row set here,
   * one there, and no purge that leaves half a task behind.
   */
  deleteConversation(parentConversationId: string): number {
    const result = this.#db
      .prepare("DELETE FROM agent_task WHERE parent_conversation_id = ?")
      .run(parentConversationId);
    return Number(result.changes);
  }
}

/** A store refuses to index a task for an agent that is not a background definition. */
function assertDispatchable(
  registered: RegisteredAgent | undefined,
  agentName: string,
): asserts registered is RegisteredAgent {
  if (registered === undefined || (registered.definition.kind !== "background" && registered.definition.kind !== "worker")) {
    throw new AgentRegistryError(
      "invalid",
      `No background agent named "${agentName}" is registered; a task row can only index a background agent.`,
      { agentName },
    );
  }
}

/** The rail row's label when the dispatcher named none: the definition's title. */
function defaultTitle(registered: RegisteredAgent): string {
  return registered.definition.identity.title;
}
