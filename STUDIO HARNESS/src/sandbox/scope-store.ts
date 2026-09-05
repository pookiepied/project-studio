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

/**
 * The sole owner of `sandbox_scope`.
 *
 * One table, one reader that takes both scopes: a project row and a
 * machine-wide row (the empty project id) are the same decision at different
 * scopes. A conversation with no project reads the machine-wide rows only.
 * The level lives on the project, not here - see `ProjectStore`.
 */

interface ScopeRow {
  project_id: string;
  path: string;
  mode: string;
  source: string;
  preset_id: string | null;
  granted_at: number;
}

function toRow(row: ScopeRow): SandboxScopeRow {
  return {
    projectId: row.project_id,
    path: row.path,
    mode: readScopeMode(row.mode),
    source: readScopeSource(row.source),
    presetId: row.preset_id,
    grantedAt: row.granted_at,
  };
}

export class SandboxScopeStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /** Every row for one project, plus the machine-wide rows beside them. */
  list(projectId: string | undefined): readonly SandboxScopeRow[] {
    try {
      if (projectId === undefined || projectId === "") {
        const rows = this.#db
          .prepare("SELECT * FROM sandbox_scope WHERE project_id = '' ORDER BY path ASC")
          .all() as unknown as ScopeRow[];
        return rows.map(toRow);
      }
      const rows = this.#db
        .prepare(
          "SELECT * FROM sandbox_scope WHERE project_id = ? OR project_id = '' ORDER BY project_id ASC, path ASC",
        )
        .all(projectId) as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /** Only the rows that belong to one project, for the settings pane. */
  listProject(projectId: string): readonly SandboxScopeRow[] {
    try {
      const rows = this.#db
        .prepare("SELECT * FROM sandbox_scope WHERE project_id = ? ORDER BY path ASC")
        .all(projectId) as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  listMachineWide(): readonly SandboxScopeRow[] {
    try {
      const rows = this.#db
        .prepare("SELECT * FROM sandbox_scope WHERE project_id = '' ORDER BY path ASC")
        .all() as unknown as ScopeRow[];
      return rows.map(toRow);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * The extra roots a conversation may reach, beyond its workspace.
   *
   * Read where the policy is built. A conversation with no project reads the
   * machine-wide rows only. A write grant implies its read: the policy
   * requires every writable root to sit inside a readable one, so the write
   * paths join both lists.
   */
  resolveRoots(projectId: string | undefined): {
    readonly readRoots: readonly string[];
    readonly writeRoots: readonly string[];
  } {
    const rows = this.list(projectId ?? "");
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
    return { readRoots, writeRoots };
  }

  grant(entry: {
    readonly projectId: string;
    readonly path: string;
    readonly mode: SandboxScopeMode;
    readonly source: SandboxScopeSource;
    readonly presetId?: string | undefined;
  }): SandboxScopeRow {
    const absolute = normalizeScopePath(entry.path);
    // Every source, not only the typed one. A volume root or a system
    // directory is the end of containment whichever way it arrived - a preset
    // whose candidates drifted, or a question the model phrased - and the
    // person who wants that wants `trusted`, which the refusal names. Only the
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
    const at = Date.now();
    try {
      this.#db
        .prepare(
          `INSERT INTO sandbox_scope (project_id, path, mode, source, preset_id, granted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, path)
           DO UPDATE SET mode = excluded.mode, source = excluded.source,
             preset_id = excluded.preset_id, granted_at = excluded.granted_at`,
        )
        .run(
          entry.projectId,
          absolute,
          entry.mode,
          entry.source,
          entry.presetId ?? null,
          at,
        );
    } catch (error) {
      throw storageErrorFrom(error);
    }
    return {
      projectId: entry.projectId,
      path: absolute,
      mode: entry.mode,
      source: entry.source,
      presetId: entry.presetId ?? null,
      grantedAt: at,
    };
  }

  revoke(projectId: string, path: string): boolean {
    const absolute = normalizeScopePath(path);
    try {
      return (
        this.#db
          .prepare("DELETE FROM sandbox_scope WHERE project_id = ? AND path = ?")
          .run(projectId, absolute).changes > 0
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /** Removes every row for one project. What a project delete calls. */
  clearProject(projectId: string): number {
    try {
      return Number(
        this.#db.prepare("DELETE FROM sandbox_scope WHERE project_id = ?").run(projectId)
          .changes,
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }
}

