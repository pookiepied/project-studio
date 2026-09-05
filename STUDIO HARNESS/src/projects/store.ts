import type { ProjectCreateInput } from "../contracts/conversations.js";
import type { ProjectIcon } from "../contracts/conversations.js";
import { createStudioUuid } from "../identity/uuid.js";
import { readSandboxLevel, validateFolderPath, type SandboxLevel } from "../sandbox/scope.js";
import { StorageError, storageErrorFrom } from "../storage/errors.js";
import type { StudioDatabase } from "../storage/database.js";

/**
 * The owner of `project` and `project_folder`.
 *
 * What a project is here is deliberately narrow and final: a name, a mark, a
 * description, many folders, and the conversations filed under it. Behaviour
 * comes later; these tables cannot be rewritten once released, so they were
 * designed for the destination rather than the first step.
 *
 * **Folders are rows, not grants.** The question "what may this agent reach"
 * already has exactly one answer — `permission_grant`, scoped by project,
 * pattern, agent, and conversation — and two tables able to authorize a read
 * would make that answer unknowable. A folder row decides what a project
 * *offers* when a turn binds sandbox roots (the same layer as today's single
 * workspace root); everything that authorizes a call still flows through the
 * kernel alone.
 */

export interface ProjectFolderRecord {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly position: number;
}

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly icon: ProjectIcon;
  readonly description: string;
  readonly folders: readonly ProjectFolderRecord[];
  readonly createdAt: number;
  /**
   * Whether this project is contained at all.
   *
   * `contained` (the default) holds the wall; `trusted` removes it for this
   * project's conversations. The escape hatch for the walk-up class, and for
   * Docker - a contained process that can reach the Docker daemon can mount
   * any path, so Docker is a level choice rather than a scope preset.
   */
  readonly sandboxLevel: SandboxLevel;
}

interface ProjectRow {
  id: string;
  name: string;
  icon: string;
  description: string;
  created_at: number;
  sandbox_level?: string | null;
}

interface FolderRow {
  id: string;
  project_id: string;
  path: string;
  name: string;
  position: number;
}

const DEFAULT_ICONS = new Set<string>([
  "arc",
  "stack",
  "grid",
  "ring",
  "wave",
  "burst",
  "prism",
  "diamond",
]);

function asIcon(value: string): ProjectIcon {
  return DEFAULT_ICONS.has(value) ? (value as ProjectIcon) : "arc";
}

/**
 * A folder row is decoration no longer: a turn binds its sandbox roots from
 * these rows, so a path that is relative, absent, a file, a volume root, or a
 * system directory is refused on write (`validateFolderPath`) rather than
 * discovered by a run standing in nothing. Validation is on write only - rows
 * written before this existed are read as they are, and a bad one is caught by
 * the turn refusal at the moment it would matter, not by a migration.
 */

function toProject(row: ProjectRow, folders: readonly FolderRow[]): ProjectRecord {
  const ordered = [...folders].sort((left, right) => left.position - right.position);
  return {
    id: row.id,
    name: row.name,
    icon: asIcon(row.icon),
    description: row.description,
    folders: ordered.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
      position: folder.position,
    })),
    createdAt: row.created_at,
    // Rows written before migration 21 have no column value; the absence of a
    // stored answer is contained, which is also what the column defaults to.
    sandboxLevel: readSandboxLevel(row.sandbox_level ?? null),
  };
}

export class ProjectStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  list(): readonly ProjectRecord[] {
    try {
      const projects = this.#db
        .prepare("SELECT * FROM project ORDER BY created_at ASC")
        .all() as unknown as ProjectRow[];
      const folders = this.#db
        .prepare("SELECT * FROM project_folder ORDER BY position ASC")
        .all() as unknown as FolderRow[];
      const byProject = new Map<string, FolderRow[]>();
      for (const folder of folders) {
        const existing = byProject.get(folder.project_id);
        if (existing === undefined) byProject.set(folder.project_id, [folder]);
        else existing.push(folder);
      }
      return projects.map((row) => toProject(row, byProject.get(row.id) ?? []));
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  get(id: string): ProjectRecord | undefined {
    try {
      const row = this.#db.prepare("SELECT * FROM project WHERE id = ?").get(id);
      if (row === undefined) return undefined;
      const folders = this.#db
        .prepare("SELECT * FROM project_folder WHERE project_id = ?")
        .all(id) as unknown as FolderRow[];
      return toProject(row as unknown as ProjectRow, folders);
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * Creates a project with its initial folders, all or nothing.
   *
   * The id may arrive from the client — conversation ids are caller-chosen,
   * and project ids follow the same shape so a navigation can begin before
   * any round trip — or be minted here when no one chose one.
   */
  create(input: ProjectCreateInput): ProjectRecord {
    const id = input.id ?? createStudioUuid();
    if (this.get(id) !== undefined) {
      throw new StorageError("conflict", { message: `A project named id "${id}" exists.` });
    }
    // Validated, and the normalized absolute form is what is stored, before
    // the transaction opens - so a bad path refuses the whole create instead
    // of surfacing as a driver error from inside it.
    const folders = (input.folders ?? []).map((folder) => ({
      ...folder,
      path: validateFolderPath(folder.path),
    }));
    const seen = new Set<string>();
    for (const folder of folders) {
      const key = folder.path.toLowerCase();
      if (seen.has(key)) {
        throw new StorageError("conflict", {
          message: `A project cannot attach the same folder twice.`,
        });
      }
      seen.add(key);
    }

    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `INSERT INTO project (id, name, icon, description, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.name,
            input.icon,
            input.description ?? "",
            input.createdAt ?? Date.now(),
          );
        let position = 0;
        const insertFolder = this.#db.prepare(
          `INSERT INTO project_folder (id, project_id, path, name, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const folder of folders) {
          insertFolder.run(
            createStudioUuid(),
            id,
            folder.path,
            folder.name,
            position++,
            Date.now(),
          );
        }
      });
    } catch (error) {
      throw storageErrorFrom(error, "internal");
    }
    return this.get(id) as ProjectRecord;
  }

  patch(
    id: string,
    change: {
      name?: string | undefined;
      icon?: ProjectIcon | undefined;
      description?: string | undefined;
    },
  ): void {
    const assignments: string[] = [];
    const values: (string | number)[] = [];
    if (change.name !== undefined) {
      assignments.push("name = ?");
      values.push(change.name);
    }
    if (change.icon !== undefined) {
      assignments.push("icon = ?");
      values.push(change.icon);
    }
    if (change.description !== undefined) {
      assignments.push("description = ?");
      values.push(change.description);
    }
    if (assignments.length === 0) return;

    try {
      this.#db.transaction(() => {
        if (
          this.#db
            .prepare("UPDATE project SET " + assignments.join(", ") + " WHERE id = ?")
            .run(...values, id).changes === 0
        ) {
          throw new StorageError("not_found", { message: `No project "${id}" exists.` });
        }
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error);
    }
  }

  /**
   * The level this project is held with.
   *
   * Read beside the policy build, where the sandbox for one conversation is
   * made. An untouched project is contained, which is also what the column
   * defaults to - so a row written before migration 21 reads the same way as
   * one written after it.
   */
  sandboxLevelOf(id: string): SandboxLevel {
    try {
      const row = this.#db.prepare("SELECT sandbox_level FROM project WHERE id = ?").get(id) as
        | { sandbox_level?: string | null }
        | undefined;
      if (row === undefined) {
        throw new StorageError("not_found", { message: `No project "${id}" exists.` });
      }
      return readSandboxLevel(row.sandbox_level ?? null);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error);
    }
  }

  /**
   * Sets whether this project is contained at all.
   *
   * A decision with its consequence next to it: trusted means the project's
   * own files are no longer the boundary. Not a toggle buried in a row.
   */
  setSandboxLevel(id: string, level: SandboxLevel): void {
    if (level !== "contained" && level !== "trusted") {
      throw new StorageError("invalid", { message: "A sandbox level is contained or trusted." });
    }
    try {
      this.#db.transaction(() => {
        if (
          this.#db.prepare("UPDATE project SET sandbox_level = ? WHERE id = ?").run(level, id)
            .changes === 0
        ) {
          throw new StorageError("not_found", { message: `No project "${id}" exists.` });
        }
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error);
    }
  }

  /**
   * Deletes the project; its conversations detach rather than vanish.
   *
   * `ON DELETE SET NULL` is what makes that true structurally instead of by
   * each caller remembering to file conversations nowhere first. The folder
   * rows cascade away with it, which is correct twice over: folders belong to
   * their project, and the same folder attached to another project keeps its
   * own independent row there.
   */
  remove(id: string): void {
    try {
      this.#db.transaction(() => {
        if (this.#db.prepare("DELETE FROM project WHERE id = ?").run(id).changes === 0) {
          throw new StorageError("not_found", { message: `No project "${id}" exists.` });
        }
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error);
    }
  }

  addFolder(
    projectId: string,
    folder: { name: string; path: string },
  ): ProjectRecord | undefined {
    // Validated before the transaction opens, the same as in `create`.
    const path = validateFolderPath(folder.path);
    try {
      this.#db.transaction(() => {        // An absent project must not become a folder without a parent; the
        // foreign key refuses it below either way, but saying why here turns
        // a constraint error into a sentence.
        if (
          this.#db.prepare("SELECT id FROM project WHERE id = ?").get(projectId) === undefined
        ) {
          throw new StorageError("not_found", {
            message: `No project "${projectId}" exists.`,
          });
        }
        const current = this.#db
          .prepare(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM project_folder WHERE project_id = ?",
          )
          .get(projectId) as unknown as { next: number };
        this.#db
          .prepare(
            `INSERT INTO project_folder (id, project_id, path, name, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(createStudioUuid(), projectId, path, folder.name, current.next, Date.now());
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      // The unique index: the same folder twice within one project.
      throw storageErrorFrom(error, "conflict");
    }
    return this.get(projectId);
  }

  /** Renames or relocates one folder. A moved folder keeps its history. */
  updateFolder(
    folderId: string,
    change: { name?: string | undefined; path?: string | undefined },
  ): boolean {
    // A relocation is a write like any other: the new path must be a real
    // directory. The row it replaces may point somewhere that no longer
    // exists - that is why the person is relocating it.
    const path = change.path === undefined ? undefined : validateFolderPath(change.path);
    const assignments: string[] = [];
    const values: string[] = [];
    if (change.name !== undefined) {
      assignments.push("name = ?");
      values.push(change.name);
    }
    if (path !== undefined) {
      assignments.push("path = ?");
      values.push(path);
    }
    if (assignments.length === 0) return false;
    try {
      this.#db.transaction(() => {
        if (
          this.#db
            .prepare(`UPDATE project_folder SET ${assignments.join(", ")} WHERE id = ?`)
            .run(...values, folderId).changes === 0
        ) {
          throw new StorageError("not_found");
        }
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw storageErrorFrom(error, "conflict");
    }
    return true;
  }

  removeFolder(folderId: string): boolean {
    try {
      return this.#db.transaction(
        () =>
          this.#db.prepare("DELETE FROM project_folder WHERE id = ?").run(folderId).changes > 0,
      );
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }
}
