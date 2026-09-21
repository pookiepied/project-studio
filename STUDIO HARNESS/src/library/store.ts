import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { createStudioUuid } from "../contracts/uuid.js";
import { ensureDirectory, libraryDirectory } from "../platform/paths.js";
import type { StudioDatabase } from "../storage/database.js";
import { StorageError } from "../storage/errors.js";

/**
 * The library: files the person chose to keep beyond one conversation.
 *
 * ---- What a record is ------------------------------------------------------
 *
 * A file the person said yes to, with what they said about it. The bytes
 * live under `data/library/<id>.<ext>` and the row here is what makes the
 * file findable: a title and a description (the model's proposal or the
 * person's words), a `subject` - who or what this is, "me", "Bruno", "the
 * logo" - and tags. The subject is the person's alone. Nothing here
 * recognises anyone; it records what the person wrote, so a later
 * conversation that asks for "my photo" finds the file the person labelled
 * as theirs, and only that.
 *
 * ---- Why the file is named by the id -------------------------------------
 *
 * Two uploads called `photo.png` must both be kept, and a re-tagged item
 * must not move: the model's search answers with a path, and a path that
 * changes under a running conversation is a path that lies. The original
 * name is a column, shown in the pane and returned to the model, but the
 * file on disk is the record's id and its original extension.
 *
 * ---- What the store does not do -----------------------------------------
 *
 * It does not decide what is worth keeping - the person does, one item at
 * a time. It does not read the files' contents into the index: search is
 * over what the person and the model said about a file, not what is in it.
 * It does not delete a file when the conversation it came from is purged;
 * keeping the file past the conversation was the point.
 */

export type LibraryKind = "image" | "document" | "audio" | "video" | "other";

export interface LibraryItem {
  readonly id: string;
  readonly kind: LibraryKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly title: string;
  readonly description: string;
  readonly subject: string;
  readonly tags: readonly string[];
  readonly sourceConversationId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Where the bytes are, absolute. */
  readonly path: string;
}

/** What a caller says about a file when adding or editing it. */
export interface LibraryFacts {
  readonly title?: string;
  readonly description?: string;
  readonly subject?: string;
  readonly tags?: readonly string[];
}

export interface LibraryAddition extends LibraryFacts {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly sourceConversationId?: string | null;
}

export interface LibraryQuery {
  /** Words matched against the title, description, subject, tags and name. */
  readonly query?: string;
  readonly kind?: LibraryKind;
  readonly subject?: string;
  readonly tag?: string;
  readonly limit?: number;
}

/** The largest file the library takes: it is a reference shelf, not a drive. */
export const MAX_LIBRARY_FILE_BYTES = 50 * 1024 * 1024;

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2_000;
const MAX_SUBJECT = 80;
const MAX_TAGS = 24;
const MAX_TAG = 40;
const MAX_NAME_LENGTH = 160;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// eslint-disable-next-line no-control-regex -- removing control characters is the point.
const UNSAFE_IN_A_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

const LIBRARY_ID = /^lib_[0-9a-f-]{36}$/;

/** The kind a mime declares; the file's family, nothing finer. */
export function kindOfMime(mimeType: string): LibraryKind {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  if (
    lower.startsWith("text/") ||
    lower === "application/pdf" ||
    lower === "application/json" ||
    lower === "application/xml" ||
    lower.includes("document") ||
    lower.includes("spreadsheet") ||
    lower.includes("presentation") ||
    lower === "application/rtf" ||
    lower === "application/epub+zip"
  ) {
    return "document";
  }
  return "other";
}

/** Tags as the store keeps them: lower-case, trimmed, unique, bounded. */
export function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  if (tags === undefined) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG);
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

function bounded(value: string | undefined, max: number): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_IN_A_NAME, " ").trim().replace(/\s+/g, " ");
  const fallback = cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
  if (fallback.length <= MAX_NAME_LENGTH) return fallback;
  const extension = extname(fallback);
  return fallback.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
}

/** The extension the stored file wears: the name's, lower-cased, or none. */
function storedExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
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

export interface LibraryStoreOptions {
  /** Where the files go; defaults to `data/library` under the Studio home. */
  readonly directory?: string;
  readonly now?: () => number;
}

export class LibraryStore {
  readonly #db: StudioDatabase;
  readonly #directory: string;
  readonly #now: () => number;

  constructor(db: StudioDatabase, options: LibraryStoreOptions = {}) {
    this.#db = db;
    this.#directory = options.directory ?? libraryDirectory();
    this.#now = options.now ?? Date.now;
  }

  /** The folder the files live in - a read root for every conversation. */
  get directory(): string {
    return this.#directory;
  }

  list(query: LibraryQuery = {}): readonly LibraryItem[] {
    const clauses: string[] = [];
    const parameters: (string | number)[] = [];
    if (query.kind !== undefined) {
      clauses.push("kind = ?");
      parameters.push(query.kind);
    }
    if (query.subject !== undefined && query.subject.trim() !== "") {
      clauses.push("LOWER(subject) LIKE ? ESCAPE '\\'");
      parameters.push(`%${escapeLike(query.subject.trim().toLowerCase())}%`);
    }
    if (query.tag !== undefined && query.tag.trim() !== "") {
      clauses.push("LOWER(tags) LIKE ? ESCAPE '\\'");
      parameters.push(`%${escapeLike(JSON.stringify(query.tag.trim().toLowerCase()))}%`);
    }
    for (const word of words(query.query)) {
      clauses.push(
        "(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(description) LIKE ? ESCAPE '\\' OR LOWER(subject) LIKE ? ESCAPE '\\' OR LOWER(tags) LIKE ? ESCAPE '\\' OR LOWER(file_name) LIKE ? ESCAPE '\\')",
      );
      const pattern = `%${escapeLike(word)}%`;
      parameters.push(pattern, pattern, pattern, pattern, pattern);
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    const rows = this.#db
      .prepare(`SELECT * FROM library_item${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...parameters, limit) as Record<string, unknown>[];
    return rows.map((row) => this.#item(row));
  }

  get(id: string): LibraryItem | undefined {
    if (!LIBRARY_ID.test(id)) return undefined;
    const row = this.#db.prepare("SELECT * FROM library_item WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : this.#item(row);
  }

  /** The bytes of one item, or undefined when the file is gone. */
  read(id: string): { readonly item: LibraryItem; readonly bytes: Buffer } | undefined {
    const item = this.get(id);
    if (item === undefined) return undefined;
    try {
      return { item, bytes: readFileSync(item.path) };
    } catch {
      return undefined;
    }
  }

  add(addition: LibraryAddition): LibraryItem {
    if (addition.bytes.byteLength === 0) {
      throw new StorageError("invalid", { message: "The file is empty." });
    }
    if (addition.bytes.byteLength > MAX_LIBRARY_FILE_BYTES) {
      throw new StorageError("invalid", {
        message: `The file is larger than the library takes (${String(MAX_LIBRARY_FILE_BYTES / (1024 * 1024))} MB).`,
      });
    }
    const mimeType = addition.mimeType.trim().toLowerCase() || "application/octet-stream";
    const fileName = safeFileName(addition.fileName);
    const id = `lib_${createStudioUuid()}`;
    const path = join(ensureDirectory(this.#directory), `${id}${storedExtension(fileName)}`);
    const now = this.#now();
    writeFileSync(path, addition.bytes);
    try {
      this.#db
        .prepare(
          `INSERT INTO library_item
             (id, kind, file_name, mime_type, byte_length, title, description, subject, tags,
              source_conversation_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          kindOfMime(mimeType),
          fileName,
          mimeType,
          addition.bytes.byteLength,
          bounded(addition.title, MAX_TITLE) || fileName,
          bounded(addition.description, MAX_DESCRIPTION),
          bounded(addition.subject, MAX_SUBJECT),
          JSON.stringify(normalizeTags(addition.tags)),
          addition.sourceConversationId ?? null,
          now,
          now,
        );
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
    const item = this.get(id);
    if (item === undefined) throw new StorageError("unavailable", { message: "The item was not saved." });
    return item;
  }

  /** Files a path that already exists on disk - a workspace file, an artifact. */
  addFromPath(path: string, facts: LibraryFacts & { readonly mimeType: string; readonly sourceConversationId?: string | null; readonly fileName?: string }): LibraryItem {
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new StorageError("invalid", { message: "There is no file at that path." });
    }
    return this.add({
      ...facts,
      fileName: facts.fileName ?? path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1),
      bytes: readFileSync(path),
    });
  }

  update(id: string, facts: LibraryFacts): LibraryItem {
    const current = this.get(id);
    if (current === undefined) {
      throw new StorageError("not_found", { message: "There is no such library item." });
    }
    const title = facts.title === undefined ? current.title : bounded(facts.title, MAX_TITLE) || current.fileName;
    const description =
      facts.description === undefined ? current.description : bounded(facts.description, MAX_DESCRIPTION);
    const subject = facts.subject === undefined ? current.subject : bounded(facts.subject, MAX_SUBJECT);
    const tags = facts.tags === undefined ? current.tags : normalizeTags(facts.tags);
    this.#db
      .prepare(
        `UPDATE library_item
            SET title = ?, description = ?, subject = ?, tags = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(title, description, subject, JSON.stringify(tags), this.#now(), id);
    const item = this.get(id);
    if (item === undefined) throw new StorageError("not_found", { message: "There is no such library item." });
    return item;
  }

  remove(id: string): boolean {
    const item = this.get(id);
    if (item === undefined) return false;
    this.#db.prepare("DELETE FROM library_item WHERE id = ?").run(id);
    rmSync(item.path, { force: true });
    return true;
  }

  /** Every distinct subject, for the pane's filter and the model's hint. */
  subjects(): readonly string[] {
    const rows = this.#db
      .prepare("SELECT DISTINCT subject FROM library_item WHERE subject <> '' ORDER BY subject")
      .all() as Record<string, unknown>[];
    return rows.map((row) => text(row.subject));
  }

  #item(row: Record<string, unknown>): LibraryItem {
    const id = text(row.id);
    const fileName = text(row.file_name);
    return {
      id,
      kind: kindOf(row.kind),
      fileName,
      mimeType: text(row.mime_type),
      byteLength: count(row.byte_length),
      title: text(row.title),
      description: text(row.description),
      subject: text(row.subject),
      tags: tagsOf(row.tags),
      sourceConversationId: typeof row.source_conversation_id === "string" ? row.source_conversation_id : null,
      createdAt: count(row.created_at),
      updatedAt: count(row.updated_at),
      path: join(this.#directory, `${id}${storedExtension(fileName)}`),
    };
  }
}

function kindOf(value: unknown): LibraryKind {
  return value === "image" || value === "document" || value === "audio" || value === "video" ? value : "other";
}

function words(query: string | undefined): readonly string[] {
  if (query === undefined) return [];
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word !== "")
    .slice(0, 8);
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
}
