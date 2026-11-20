import { createStudioUuid } from "../contracts/uuid.js";
import { AppSettings, type NamespacedSettings } from "../storage/app-settings.js";
import type { StudioDatabase } from "../storage/database.js";
import { StorageError } from "../storage/errors.js";

/**
 * Studio's memory: the short claims worth carrying from one conversation to
 * the next, and the person's own profile.
 *
 * ---- What a memory is ------------------------------------------------------
 *
 * One sentence the model saved with a tool call, or the person wrote in
 * Personalization: "Prefers TypeScript over JavaScript", "Is planning a trip
 * to New Zealand in March". Nothing here extracts memories from a transcript
 * on its own - the person asked for capture to cost no model tokens of its
 * own, so the only writers are an explicit tool call and the settings pane.
 *
 * ---- Scope is decided by the harness, not by the model ---------------------
 *
 * A memory is `personal` (about the person; every conversation sees it) or
 * `project` (about one project's work; only that project's conversations see
 * it). The model chooses only between those two words. Which project is never
 * an argument: the route derives it from the conversation the call came from,
 * and a `project` save from a conversation filed under no project is refused
 * rather than silently widened to personal. One rule, enforced in one place,
 * is what keeps the two from being confused.
 *
 * ---- Why there is no organizer ---------------------------------------------
 *
 * Duplicates are caught by exact normalized text, and near-duplicates are
 * surfaced (not merged) by full-text search at save time, so the model can
 * update an existing memory instead of adding a second. That is the whole of
 * the organization this store does; it never asks a model to tidy anything.
 */

export type MemoryScope = "personal" | "project";
export type MemoryKind = "fact" | "preference" | "instruction" | "event";
export type MemoryPriority = 1 | 2 | 3;
export type MemoryAuthor = "model" | "user";

export const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "preference", "instruction", "event"];
export const MEMORY_SCOPES: readonly MemoryScope[] = ["personal", "project"];

export interface MemoryItem {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly projectId: string | null;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly tags: readonly string[];
  readonly priority: MemoryPriority;
  readonly author: MemoryAuthor;
  readonly sourceConversationId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MemoryDraft {
  readonly content: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  /** Required exactly when `scope` is `project`; the caller derives it. */
  readonly projectId?: string | null;
  readonly tags?: readonly string[];
  readonly priority?: MemoryPriority;
  readonly author: MemoryAuthor;
  readonly sourceConversationId?: string | null;
}

export interface MemoryChange {
  readonly content?: string;
  readonly kind?: MemoryKind;
  readonly tags?: readonly string[];
  readonly priority?: MemoryPriority;
  /** A move between personal and project; the caller derives `projectId` as for a save. */
  readonly scope?: MemoryScope;
  readonly projectId?: string | null;
}

/** Which memories a reader may see. `undefined` project means personal only. */
export interface MemoryVisibility {
  readonly projectId?: string | undefined;
  /** The settings pane sees everything; a conversation never does. */
  readonly everything?: boolean;
}

export interface MemoryQuery extends MemoryVisibility {
  readonly query?: string;
  readonly kind?: MemoryKind;
  readonly scope?: MemoryScope;
  readonly limit?: number;
}

export interface MemorySaveResult {
  readonly item: MemoryItem;
  /** True when an identical memory already existed and was returned instead. */
  readonly existed: boolean;
  /** Visible memories that share words with the new one, best first. */
  readonly similar: readonly MemoryItem[];
}

export interface MemoryProfile {
  readonly name: string;
  readonly preferredName: string;
  readonly about: string;
  readonly replyStyle: string;
}

export interface MemorySettings {
  /** Whether new conversations receive the memory context block. */
  readonly enabled: boolean;
}

export const MAX_MEMORY_CONTENT = 500;
export const MAX_MEMORY_ITEMS = 5_000;
const MAX_TAGS = 8;
const MAX_TAG = 32;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SIMILAR_LIMIT = 3;

const PROFILE_LIMITS: Readonly<Record<keyof MemoryProfile, number>> = {
  name: 80,
  preferredName: 80,
  about: 1_000,
  replyStyle: 1_000,
};

export const EMPTY_PROFILE: MemoryProfile = { name: "", preferredName: "", about: "", replyStyle: "" };

const MEMORY_ID = /^mem_[0-9a-f-]{36}$/;

function refused(message: string): StorageError {
  return new StorageError("invalid", { message });
}

function oneLine(value: string, max: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

/** Tags as stored: lower-case, trimmed, unique, bounded. */
export function normalizeMemoryTags(tags: readonly string[] | undefined): readonly string[] {
  if (tags === undefined) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = oneLine(raw, MAX_TAG).toLowerCase();
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

function content(value: string): string {
  const cleaned = oneLine(value, MAX_MEMORY_CONTENT + 1);
  if (cleaned === "") throw refused("A memory needs some text.");
  if (cleaned.length > MAX_MEMORY_CONTENT) {
    throw refused(`A memory is one short statement of at most ${String(MAX_MEMORY_CONTENT)} characters. Split it or say it more briefly.`);
  }
  return cleaned;
}

/** The comparison key for exact duplicates: case, spacing and end punctuation ignored. */
function duplicateKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.!?\s]+$/u, "").trim();
}

/**
 * A user's words as an FTS5 expression that cannot be a syntax error.
 *
 * Each word is quoted (so `AND`, `-` or a stray `"` are text, not operators)
 * and prefix-matched, then joined with OR so a memory sharing any word is a
 * candidate and BM25 decides the order.
 */
export function ftsExpression(query: string | undefined): string | undefined {
  if (query === undefined) return undefined;
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(words.filter((word) => word.length >= 2))].slice(0, 16);
  if (unique.length === 0) return undefined;
  return unique.map((word) => `"${word}"*`).join(" OR ");
}

function isKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value);
}

function isScope(value: unknown): value is MemoryScope {
  return typeof value === "string" && (MEMORY_SCOPES as readonly string[]).includes(value);
}

function priorityOf(value: unknown): MemoryPriority {
  return value === 1 || value === 3 ? value : 2;
}

function tagsOf(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function item(row: Record<string, unknown>): MemoryItem {
  const scope = isScope(row["scope"]) ? row["scope"] : "personal";
  const kind = isKind(row["kind"]) ? row["kind"] : "fact";
  return {
    id: text(row["id"]),
    scope,
    projectId: nullableText(row["project_id"]),
    kind,
    content: text(row["content"]),
    tags: tagsOf(row["tags"]),
    priority: priorityOf(row["priority"]),
    author: row["author"] === "user" ? "user" : "model",
    sourceConversationId: nullableText(row["source_conversation_id"]),
    createdAt: count(row["created_at"]),
    updatedAt: count(row["updated_at"]),
  };
}

/** The SQL clause and parameters that say what one reader may see. */
function visibilityClause(visibility: MemoryVisibility): { readonly sql: string; readonly parameters: readonly string[] } {
  if (visibility.everything === true) return { sql: "1 = 1", parameters: [] };
  if (visibility.projectId === undefined) return { sql: "m.scope = 'personal'", parameters: [] };
  return {
    sql: "(m.scope = 'personal' OR (m.scope = 'project' AND m.project_id = ?))",
    parameters: [visibility.projectId],
  };
}

export interface MemoryStoreOptions {
  readonly now?: () => number;
}

export class MemoryStore {
  readonly #db: StudioDatabase;
  readonly #settings: NamespacedSettings;
  readonly #now: () => number;

  constructor(db: StudioDatabase, options: MemoryStoreOptions = {}) {
    this.#db = db;
    this.#settings = new AppSettings(db).namespace("memory");
    this.#now = options.now ?? Date.now;
  }

  /** Visible memories, best match first when there is a query, newest first otherwise. */
  list(query: MemoryQuery = {}): readonly MemoryItem[] {
    const visible = visibilityClause(query);
    const clauses = [visible.sql];
    const parameters: (string | number)[] = [...visible.parameters];
    if (query.kind !== undefined) {
      clauses.push("m.kind = ?");
      parameters.push(query.kind);
    }
    if (query.scope !== undefined) {
      clauses.push("m.scope = ?");
      parameters.push(query.scope);
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
    const expression = ftsExpression(query.query);
    if (expression === undefined) {
      const rows = this.#db
        .prepare(
          `SELECT m.* FROM memory_item AS m WHERE ${clauses.join(" AND ")}
            ORDER BY m.updated_at DESC, m.id LIMIT ?`,
        )
        .all(...parameters, limit) as Record<string, unknown>[];
      return rows.map(item);
    }
    const rows = this.#db
      .prepare(
        `SELECT m.* FROM memory_item_fts AS f JOIN memory_item AS m ON m.rowid = f.rowid
          WHERE memory_item_fts MATCH ? AND ${clauses.join(" AND ")}
          ORDER BY bm25(memory_item_fts) ASC, m.priority DESC, m.updated_at DESC LIMIT ?`,
      )
      .all(expression, ...parameters, limit) as Record<string, unknown>[];
    return rows.map(item);
  }

  /** The memories a new conversation's context block draws from, in one read. */
  forContext(visibility: MemoryVisibility): readonly MemoryItem[] {
    const visible = visibilityClause(visibility);
    const rows = this.#db
      .prepare(
        `SELECT m.* FROM memory_item AS m WHERE ${visible.sql}
          ORDER BY m.priority DESC, m.updated_at DESC, m.id LIMIT 400`,
      )
      .all(...visible.parameters) as Record<string, unknown>[];
    return rows.map(item);
  }

  count(visibility: MemoryVisibility = { everything: true }): number {
    const visible = visibilityClause(visibility);
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS total FROM memory_item AS m WHERE ${visible.sql}`)
      .get(...visible.parameters) as Record<string, unknown> | undefined;
    return count(row?.["total"]);
  }

  /** One memory, when it exists and this reader may see it. */
  get(id: string, visibility: MemoryVisibility = { everything: true }): MemoryItem | undefined {
    if (!MEMORY_ID.test(id)) return undefined;
    const visible = visibilityClause(visibility);
    const row = this.#db
      .prepare(`SELECT m.* FROM memory_item AS m WHERE m.id = ? AND ${visible.sql}`)
      .get(id, ...visible.parameters) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : item(row);
  }

  /**
   * Saves one memory, or answers with the identical one already kept.
   *
   * The duplicate check is within the same scope and project: the same words
   * saved as personal and as one project's are two different claims about
   * where they apply.
   */
  save(draft: MemoryDraft): MemorySaveResult {
    const text = content(draft.content);
    if (!isKind(draft.kind)) throw refused("The kind must be fact, preference, instruction or event.");
    if (!isScope(draft.scope)) throw refused("The scope must be personal or project.");
    const projectId = draft.scope === "project" ? draft.projectId ?? null : null;
    if (draft.scope === "project" && (projectId === null || projectId === "")) {
      throw refused(
        "This conversation is not filed under a project, so there is no project to remember this for. " +
          "Save it as personal if it is about the user, or not at all.",
      );
    }
    const visibility: MemoryVisibility = projectId === null ? {} : { projectId };
    const key = duplicateKey(text);
    const sameScope = this.#db
      .prepare(
        "SELECT * FROM memory_item WHERE scope = ? AND project_id IS ? AND LOWER(content) LIKE ? ESCAPE '\\'",
      )
      .all(draft.scope, projectId, `${escapeLike(key)}%`) as Record<string, unknown>[];
    const identical = sameScope.map(item).find((candidate) => duplicateKey(candidate.content) === key);
    if (identical !== undefined) {
      return { item: identical, existed: true, similar: [] };
    }
    if (this.count() >= MAX_MEMORY_ITEMS) {
      throw refused(
        `Memory is full (${String(MAX_MEMORY_ITEMS)} items). Forget or merge older memories before saving new ones.`,
      );
    }
    const similar = this.list({ ...visibility, query: text, limit: SIMILAR_LIMIT });
    const now = this.#now();
    const saved: MemoryItem = {
      id: `mem_${createStudioUuid()}`,
      scope: draft.scope,
      projectId,
      kind: draft.kind,
      content: text,
      tags: normalizeMemoryTags(draft.tags),
      priority: priorityOf(draft.priority),
      author: draft.author,
      sourceConversationId: draft.sourceConversationId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.#db
      .prepare(
        `INSERT INTO memory_item (id, scope, project_id, kind, content, tags, priority, author,
           source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saved.id,
        saved.scope,
        saved.projectId,
        saved.kind,
        saved.content,
        JSON.stringify(saved.tags),
        saved.priority,
        saved.author,
        saved.sourceConversationId,
        saved.createdAt,
        saved.updatedAt,
      );
    return { item: saved, existed: false, similar };
  }

  /**
   * Changes a visible memory in place.
   *
   * A scope change obeys the save rule: `project` needs the project the
   * caller derived, and `personal` clears it.
   */
  update(id: string, change: MemoryChange, visibility: MemoryVisibility = { everything: true }): MemoryItem {
    const current = this.get(id, visibility);
    if (current === undefined) throw new StorageError("not_found", { message: `There is no memory ${id} here.` });
    if (change.kind !== undefined && !isKind(change.kind)) {
      throw refused("The kind must be fact, preference, instruction or event.");
    }
    if (change.scope !== undefined && !isScope(change.scope)) throw refused("The scope must be personal or project.");
    const scope = change.scope ?? current.scope;
    const projectId = change.scope === undefined
      ? current.projectId
      : scope === "project" ? change.projectId ?? null : null;
    if (scope === "project" && (projectId === null || projectId === "")) {
      throw refused("This conversation is not filed under a project, so the memory cannot be moved to one.");
    }
    const next: MemoryItem = {
      ...current,
      scope,
      projectId,
      ...(change.content === undefined ? {} : { content: content(change.content) }),
      ...(change.kind === undefined ? {} : { kind: change.kind }),
      ...(change.tags === undefined ? {} : { tags: normalizeMemoryTags(change.tags) }),
      ...(change.priority === undefined ? {} : { priority: priorityOf(change.priority) }),
      updatedAt: this.#now(),
    };
    this.#db
      .prepare(
        "UPDATE memory_item SET scope = ?, project_id = ?, content = ?, kind = ?, tags = ?, priority = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.scope, next.projectId, next.content, next.kind, JSON.stringify(next.tags), next.priority, next.updatedAt, id);
    return next;
  }

  /** Removes a visible memory. Answers whether there was one to remove. */
  forget(id: string, visibility: MemoryVisibility = { everything: true }): boolean {
    if (this.get(id, visibility) === undefined) return false;
    this.#db.prepare("DELETE FROM memory_item WHERE id = ?").run(id);
    return true;
  }

  profile(): MemoryProfile {
    const stored = this.#settings.get("profile");
    if (stored === undefined) return EMPTY_PROFILE;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== "object" || parsed === null) return EMPTY_PROFILE;
      const record = parsed as Record<string, unknown>;
      return {
        name: text(record["name"]),
        preferredName: text(record["preferredName"]),
        about: text(record["about"]),
        replyStyle: text(record["replyStyle"]),
      };
    } catch {
      return EMPTY_PROFILE;
    }
  }

  /** Merges the given fields into the profile; an empty string clears a field. */
  setProfile(change: { readonly [Field in keyof MemoryProfile]?: string | undefined }): MemoryProfile {
    const current = this.profile();
    const next: Record<keyof MemoryProfile, string> = { ...current };
    for (const field of Object.keys(PROFILE_LIMITS) as (keyof MemoryProfile)[]) {
      const value = change[field];
      if (value === undefined) continue;
      const limit = PROFILE_LIMITS[field];
      const cleaned = field === "about" || field === "replyStyle" ? value.trim().slice(0, limit + 1) : oneLine(value, limit + 1);
      if (cleaned.length > limit) throw refused(`The ${field} field takes at most ${String(limit)} characters.`);
      next[field] = cleaned;
    }
    this.#settings.set("profile", JSON.stringify(next));
    return next;
  }

  settings(): MemorySettings {
    return { enabled: this.#settings.get("enabled") !== "false" };
  }

  setSettings(change: { readonly enabled?: boolean | undefined }): MemorySettings {
    if (change.enabled !== undefined) this.#settings.set("enabled", change.enabled ? "true" : "false");
    return this.settings();
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
