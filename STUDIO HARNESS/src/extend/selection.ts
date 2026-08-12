import type { StudioDatabase } from "../storage/database.js";
import type { ExtensionKind } from "./inventory.js";

/**
 * What the user chose to switch on, per project.
 *
 * Half of the spine. `inventory.ts` knows what exists; this knows what was
 * picked. Neither knows what an MCP server or a skill is, which is the property
 * that lets a fourth kind arrive without editing either file.
 *
 * **This is scoping, not permission.** A row here decides whether an extension
 * is present for a project at all. It never authorizes a call — everything
 * present still passes the kernel, per call, exactly as before. Enabling can
 * only subtract from what the model can reach; it can never add to what the
 * model may do.
 *
 * The store holds one thing: the decisions the user made. Absence is off,
 * because off is the default for every kind — a project that has chosen nothing
 * has no rows, and a fresh project starts empty rather than starting with a
 * generated row per installed extension.
 */

export interface SelectionKey {
  readonly kind: ExtensionKind;
  readonly extensionId: string;
  readonly projectId: string;
}

export class ExtensionSelectionStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * Whether this project switched this extension on.
   *
   * False for anything never decided. There is deliberately no third answer:
   * "never asked" and "turned off" both mean the extension is absent, and a
   * distinction with no consequence is a state whose error message cannot be
   * written.
   */
  isEnabled(key: SelectionKey): boolean {
    const row = this.#db.handle
      .prepare(
        `SELECT enabled FROM extension_selection
          WHERE kind = ? AND extension_id = ? AND project_id = ?`,
      )
      .get(key.kind, key.extensionId, key.projectId) as
      | { enabled: number }
      | undefined;

    return row?.enabled === 1;
  }

  /** Every extension of one kind this project switched on. */
  enabledIds(kind: ExtensionKind, projectId: string): readonly string[] {
    const rows = this.#db.handle
      .prepare(
        `SELECT extension_id FROM extension_selection
          WHERE kind = ? AND project_id = ? AND enabled = 1
          ORDER BY extension_id`,
      )
      .all(kind, projectId) as { extension_id: string }[];

    return rows.map((row) => row.extension_id);
  }

  /**
   * Records a decision.
   *
   * An explicit off is written rather than deleted. It reads the same as
   * absence today, and keeping the row means the moment of the decision
   * survives — which is what makes "you switched this off last Tuesday"
   * answerable when someone asks why a tool disappeared.
   */
  set(key: SelectionKey, enabled: boolean): void {
    this.#db.handle
      .prepare(
        `INSERT INTO extension_selection
           (kind, extension_id, project_id, enabled, decided_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kind, extension_id, project_id)
         DO UPDATE SET enabled = excluded.enabled, decided_at = excluded.decided_at`,
      )
      .run(key.kind, key.extensionId, key.projectId, enabled ? 1 : 0, Date.now());
  }

  /**
   * Forgets an extension everywhere, for when it is uninstalled.
   *
   * Across every project, because the thing being selected no longer exists.
   * Leaving the rows behind would mean reinstalling something later silently
   * switched it back on in projects the user has not opened since — a decision
   * they made about a different installation.
   *
   * Selections are not grants and this is not a revoke. Grants are revoked
   * separately, by the grant store, which is the only thing allowed to decide
   * what an approval meant.
   */
  forget(kind: ExtensionKind, extensionId: string): number {
    const result = this.#db.handle
      .prepare(`DELETE FROM extension_selection WHERE kind = ? AND extension_id = ?`)
      .run(kind, extensionId);

    return Number(result.changes);
  }
}
