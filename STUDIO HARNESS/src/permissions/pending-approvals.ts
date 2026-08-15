import type { StudioDatabase } from "../storage/database.js";
import { StorageError } from "../storage/errors.js";
import type { PermissionDecision, PermissionRequest } from "./policy.js";

/**
 * The durable half of the approval queue.
 *
 * A question put to a person is a decision the system is waiting on, and ADR
 * 0036 makes those durable: the row survives a restart so the person is asked
 * again rather than silently never asked. The *promise* a caller is waiting on
 * cannot survive a restart — that run is gone — but the question can, and a
 * queue the UI can still render after a crash is the difference between
 * "re-prompt me" and "nothing happened and nobody knows why".
 *
 * Nothing here holds a secret. A request names a capability and a target.
 */

export interface StoredApproval {
  readonly id: string;
  readonly request: PermissionRequest;
  readonly decision: PermissionDecision;
  readonly createdAt: number;
}

interface Row {
  id: string;
  request: string;
  decision: string;
  asked_at: number;
}

export class PendingApprovalStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  add(approval: StoredApproval): void {
    this.#db
      .prepare(
        `INSERT INTO pending_approval (id, request, decision, asked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        approval.id,
        JSON.stringify(approval.request),
        JSON.stringify(approval.decision),
        approval.createdAt,
      );
  }

  remove(id: string): void {
    this.#db.prepare("DELETE FROM pending_approval WHERE id = ?").run(id);
  }

  /** Oldest first: the person should answer what has waited longest. */
  list(): readonly StoredApproval[] {
    const rows = this.#db
      .prepare("SELECT id, request, decision, asked_at FROM pending_approval ORDER BY asked_at")
      .all() as unknown as Row[];

    return rows.map((row) => ({
      id: row.id,
      request: parse<PermissionRequest>(row.request, row.id),
      decision: parse<PermissionDecision>(row.decision, row.id),
      createdAt: row.asked_at,
    }));
  }
}

function parse<T>(raw: string, id: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new StorageError("invalid", {
      message: `The stored approval "${id}" is unreadable.`,
    });
  }
}
