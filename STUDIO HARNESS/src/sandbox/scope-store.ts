import { StorageError, storageErrorFrom } from "../storage/errors.js";
import type { StudioDatabase } from "../storage/database.js";
import {
  normalizeScopePath,
  readScopeMode,
  readScopeSource,
  systemScopeRefusal,
  validateCustomScopePath,
  type SandboxScopeMode,
  type SandboxScopeRow,
  type SandboxScopeSource,
} from "./scope.js";
import { gitConfigRoots } from "./policy.js";

/**
 * The sole owner of `sandbox_scope`.
 *
 * One table, one reader that takes all three scopes: a conversation row (a
 * conversation id, migration 26), a project row, and a machine-wide row (the
 * empty project id) are the same decision at different scopes. A conversation
 * reads its own rows, its project's rows when it has a project, and the
 * machine-wide rows. The level lives on the project, not here - see
 * `ProjectStore`.
 */

interface ScopeRow {
  project_id: string;
  conversation_id: string;
  path: string;
  mode: string;
  source: string;
  granted_at: number;
}

function toRow(row: ScopeRow): SandboxScopeRow {
  return {
    projectId: row.project_id,
    conversationId: row.conversation_id,
    path: row.path,
    mode: readScopeMode(row.mode),
    source: readScopeSource(row.source),
    grantedAt: row.granted_at,
  };
}

export class SandboxScopeStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * Every row one conversation reads: its own, its project's, and the
   * machine-wide ones. Either id may be absent; the machine-wide rows
   * always answer.
   */
  list(projectId: string | undefined, conversationId?: string): readonly SandboxScopeRow[] {
    try {
      const rows = this.#db
        .prepare(
          `SELECT * FROM sandbox_scope
            WHERE (conversation_id = '' AND (project_id = '' OR project_id = ?))
               OR (conversation_id = ? AND conversation_id <> '')
            ORDER BY conversation_id DESC, project_id ASC, path ASC`,
        )
        .all(projectId ?? "", conversationId ?? "") as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /** Only the rows that belong to one project, for the settings pane. */
  listProject(projectId: string): readonly SandboxScopeRow[] {
    try {
      const rows = this.#db
        .prepare(
          "SELECT * FROM sandbox_scope WHERE project_id = ? AND conversation_id = '' ORDER BY path ASC",
        )
        .all(projectId) as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  listMachineWide(): readonly SandboxScopeRow[] {
    try {
      const rows = this.#db
        .prepare(
          "SELECT * FROM sandbox_scope WHERE project_id = '' AND conversation_id = '' ORDER BY path ASC",
        )
        .all() as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * Every conversation row there is, for the settings pane.
   *
   * All of them rather than one conversation's, because the pane is where a
   * person finds the grant they may not remember making, and a grant made in
   * a conversation they closed last week is exactly that one.
   */
  listConversations(): readonly SandboxScopeRow[] {
    try {
      const rows = this.#db
        .prepare(
          "SELECT * FROM sandbox_scope WHERE conversation_id <> '' ORDER BY conversation_id ASC, path ASC",
        )
        .all() as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * The extra roots a conversation may reach, beyond its workspace.
   *
   * Read where the policy is built. A conversation reads its own rows, its
   * project's when it has one, and the machine-wide rows. A write grant
   * implies its read: the policy requires every writable root to sit inside
   * a readable one, so the write paths join both lists. The user's git
   * configuration rides along too - `gitConfigRoots` - because it is owed to
   * every conversation that runs a contained git, not to any row the person
   * chose.
   */
  resolveRoots(
    projectId: string | undefined,
    conversationId?: string,
  ): {
    readonly readRoots: readonly string[];
    readonly writeRoots: readonly string[];
  } {
    const rows = this.list(projectId ?? "", conversationId);
    const readRoots: string[] = [];
    const writeRoots: string[] = [];
    for (const row of rows) {
      if (row.mode === "write") {
        if (!readRoots.includes(row.path)) readRoots.push(row.path);
        if (!writeRoots.includes(row.path)) writeRoots.push(row.path);
      } else {
        if (!readRoots.includes(row.path)) readRoots.push(row.path);
      }
    }
    for (const root of gitConfigRoots()) {
      if (!readRoots.includes(root)) readRoots.push(root);
    }
    return { readRoots, writeRoots };
  }

  grant(entry: {
    readonly projectId: string;
    /** Set for a conversation grant; the row then belongs to no project. */
    readonly conversationId?: string;
    readonly path: string;
    readonly mode: SandboxScopeMode;
    readonly source: SandboxScopeSource;
  }): SandboxScopeRow {
    const absolute = normalizeScopePath(entry.path);
    // Every source, not only the typed one. A volume root or a system
    // directory is the end of the boundary whichever way it arrived - typed,
    // or a question the model phrased - and the person who wants that wants
    // `trusted`, which the refusal names. Only the
    // existence and absoluteness checks are particular to a typed path, and
    // `validateCustomScopePath` runs the refusal as part of its own work.
    const refusal = systemScopeRefusal(absolute);
    if (refusal !== undefined) {
      throw new StorageError("invalid", { message: refusal });
    }
    if (entry.source === "custom") {
      validateCustomScopePath(absolute);
    }
    if (entry.projectId !== "" && entry.projectId.trim() === "") {
      throw new StorageError("invalid", { message: "A project scope needs a project id." });
    }
    const conversationId = entry.conversationId ?? "";
    if (conversationId.trim() !== conversationId || (entry.conversationId !== undefined && conversationId === "")) {
      throw new StorageError("invalid", { message: "A conversation scope needs a conversation id." });
    }
    // A conversation row belongs to the conversation, not to whichever
    // project it happened to be filed under: it is read by the conversation
    // id alone, so the project id is the empty string.
    const projectId = conversationId === "" ? entry.projectId : "";
    const at = Date.now();
    try {
      this.#db
        .prepare(
          `INSERT INTO sandbox_scope (project_id, conversation_id, path, mode, source, granted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, conversation_id, path)
           DO UPDATE SET mode = excluded.mode, source = excluded.source,
             granted_at = excluded.granted_at`,
        )
        .run(projectId, conversationId, absolute, entry.mode, entry.source, at);
    } catch (error) {
      throw storageErrorFrom(error);
    }
    return {
      projectId,
      conversationId,
      path: absolute,
      mode: entry.mode,
      source: entry.source,
      grantedAt: at,
    };
  }

  /** Removes one project or machine-wide row. */
  revoke(projectId: string, path: string): boolean {
    const absolute = normalizeScopePath(path);
    try {
      return (
        this.#db
          .prepare(
            "DELETE FROM sandbox_scope WHERE project_id = ? AND conversation_id = '' AND path = ?",
          )
          .run(projectId, absolute).changes > 0
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /** Removes one conversation row. */
  revokeConversation(conversationId: string, path: string): boolean {
    const absolute = normalizeScopePath(path);
    try {
      return (
        this.#db
          .prepare("DELETE FROM sandbox_scope WHERE conversation_id = ? AND path = ?")
          .run(conversationId, absolute).changes > 0
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /** Removes every row for one project. What a project delete calls. */
  clearProject(projectId: string): number {
    try {
      return Number(
        this.#db
          .prepare("DELETE FROM sandbox_scope WHERE project_id = ? AND conversation_id = ''")
          .run(projectId).changes,
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /** Removes every row for one conversation. What the purge calls. */
  clearConversation(conversationId: string): number {
    if (conversationId === "") return 0;
    try {
      return Number(
        this.#db
          .prepare("DELETE FROM sandbox_scope WHERE conversation_id = ?")
          .run(conversationId).changes,
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * Carries one conversation's folder grants to a fork.
   *
   * A conversation row belongs to the conversation alone - the project id on
   * it is the empty string by construction - so the copy is exact except for
   * the conversation id. The granted moment travels rather than restamping:
   * the decision happened when it happened. Called only from
   * `conversations/fork.ts`, after the fork's index row.
   */
  duplicateConversation(sourceId: string, targetId: string): number {
    if (sourceId === "" || targetId === "") return 0;
    try {
      const result = this.#db
        .prepare(
          `INSERT INTO sandbox_scope
             (project_id, conversation_id, path, mode, source, granted_at)
           SELECT project_id, ?, path, mode, source, granted_at
             FROM sandbox_scope
            WHERE conversation_id = ?`,
        )
        .run(targetId, sourceId);
      return Number(result.changes);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }
}

