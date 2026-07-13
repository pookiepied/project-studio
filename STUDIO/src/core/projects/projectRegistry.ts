/**
 * Local project registry.
 *
 * The canonical list of projects the user has opened, persisted as JSON at
 * `<studio home>/data/projects.json`. Local-only by design: cloud conversations
 * never carry local project data, so nothing here is ever synced.
 *
 * Two removal semantics, deliberately distinct:
 *   • remove — drops the entry from the listing. Nothing on disk is touched.
 *   • delete — drops the entry and deletes Studio's own data for the project.
 *              The user's source folder is never touched, by either one.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/core/logging/logger";
import {
  getStudioProjectDir,
  getStudioProjectRegistryPath,
  getStudioProjectsHome,
} from "@/core/platform/studioPaths";
import {
  PROJECT_REGISTRY_SCHEMA_VERSION,
  type ProjectAccessMode,
  type ProjectEntry,
  type ProjectRegistry,
} from "./types";

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_text_file", { path });
  } catch {
    return null;
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function projectNameFromPath(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Derive a stable id from the folder path (FNV-1a, case-insensitive) so that
 * removing and re-adding the same folder lands on the same project data dir.
 */
function projectIdForPath(path: string): string {
  const key = normalizePath(path).toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const slug = projectNameFromPath(path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "project";
  return `${slug}-${hash.toString(16).padStart(8, "0")}`;
}

function emptyRegistry(): ProjectRegistry {
  return { schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION, projects: [] };
}

function sortByRecent(projects: ProjectEntry[]): ProjectEntry[] {
  return [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export const projectRegistry = {
  async load(): Promise<ProjectRegistry> {
    try {
      const raw = await readTextFile(await getStudioProjectRegistryPath());
      if (!raw) return emptyRegistry();
      const parsed = JSON.parse(raw) as ProjectRegistry;
      if (!Array.isArray(parsed.projects)) return emptyRegistry();
      return { ...emptyRegistry(), ...parsed, projects: sortByRecent(parsed.projects) };
    } catch (error) {
      logger.error("ProjectRegistry", "Failed to read registry", error);
      return emptyRegistry();
    }
  },

  async save(registry: ProjectRegistry): Promise<void> {
    const next: ProjectRegistry = {
      schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
      projects: sortByRecent(registry.projects),
    };
    await writeTextFile(await getStudioProjectRegistryPath(), JSON.stringify(next, null, 2));
  },

  async list(): Promise<ProjectEntry[]> {
    return (await this.load()).projects;
  },

  /** Adds the folder if unknown, otherwise refreshes it. Returns the entry. */
  async add(path: string, options?: { name?: string; accessMode?: ProjectAccessMode }): Promise<ProjectEntry> {
    const registry = await this.load();
    const id = projectIdForPath(path);
    const now = Date.now();
    const existing = registry.projects.find((project) => project.id === id);

    const entry: ProjectEntry = existing
      ? { ...existing, lastOpenedAt: now, ...(options?.name ? { name: options.name } : {}), ...(options?.accessMode ? { accessMode: options.accessMode } : {}) }
      : {
          id,
          name: options?.name ?? projectNameFromPath(path),
          path: normalizePath(path),
          createdAt: now,
          lastOpenedAt: now,
          accessMode: options?.accessMode,
        };

    const projects = existing
      ? registry.projects.map((project) => (project.id === id ? entry : project))
      : [...registry.projects, entry];

    await this.save({ ...registry, projects });
    // Studio's own per-project data dir. Created eagerly so conversation
    // artifacts have somewhere to land without a later existence check.
    await invoke("create_directory", { path: await getStudioProjectDir(id) }).catch(() => {});
    return entry;
  },

  async rename(id: string, name: string): Promise<void> {
    const registry = await this.load();
    await this.save({
      ...registry,
      projects: registry.projects.map((project) => (project.id === id ? { ...project, name } : project)),
    });
  },

  async touch(id: string): Promise<void> {
    const registry = await this.load();
    await this.save({
      ...registry,
      projects: registry.projects.map((project) =>
        project.id === id ? { ...project, lastOpenedAt: Date.now() } : project,
      ),
    });
  },

  /** Drops the entry from the listing. Nothing on disk is removed. */
  async remove(id: string): Promise<void> {
    const registry = await this.load();
    await this.save({ ...registry, projects: registry.projects.filter((project) => project.id !== id) });
  },

  /**
   * Drops the entry and deletes Studio's data folder for it. The user's source
   * folder is never deleted — the guard below makes an out-of-tree path a no-op.
   */
  async delete(id: string): Promise<void> {
    const projectDir = await getStudioProjectDir(id);
    const projectsHome = await getStudioProjectsHome();
    if (!normalizePath(projectDir).startsWith(`${normalizePath(projectsHome)}/`)) {
      logger.error("ProjectRegistry", `Refusing to delete outside the projects root: ${projectDir}`);
      return;
    }
    await this.remove(id);
    await invoke("delete_directory", { path: projectDir }).catch((error) => {
      logger.error("ProjectRegistry", `Failed to delete project data: ${projectDir}`, error);
    });
  },
};
