/** Access mode carried over from the chat project context. */
export type ProjectAccessMode = "review" | "autonomous";

/**
 * One entry in the local project registry.
 *
 * `path` points at the user's own source folder. Studio never writes into it —
 * per-project Studio data lives under data/projects/<id>/ instead.
 */
export interface ProjectEntry {
  /** Stable id, derived from `path` so re-adding the same folder reuses it. */
  id: string;
  /** Display name — defaults to the folder name, renameable. */
  name: string;
  /** Absolute path to the user's project folder. */
  path: string;
  createdAt: number;
  lastOpenedAt: number;
  accessMode?: ProjectAccessMode;
}

export interface ProjectRegistry {
  schemaVersion: number;
  projects: ProjectEntry[];
}

export const PROJECT_REGISTRY_SCHEMA_VERSION = 1;
