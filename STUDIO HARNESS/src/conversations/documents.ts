import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { createStudioUuid } from "../contracts/uuid.js";
import { DocumentError } from "../documents/errors.js";
import { decodeTextBytes } from "../documents/text-encoding.js";
import {
  documentFormatOf,
  extractDocument,
  needsOcr,
  pageRanges,
  renderPages,
  type ExtractedDocument,
} from "../documents/extract.js";
import { conversationAttachmentsDirectory, ensureDirectory } from "../platform/paths.js";
import type { StudioDatabase } from "../storage/database.js";
import { StorageError } from "../storage/errors.js";
import { ATTACHMENT_NAME_MAX_CHARS, DOCUMENT_INLINE_CHARS, DOCUMENT_MAX_BYTES } from "../contracts/media-limits.js";

/**
 * The documents a person attaches to a conversation, and how the model
 * learns of them.
 *
 * ---- Why documents are not attachments -------------------------------------
 *
 * A picture rides the message: the engine carries image blocks to the
 * model and Flue's attachment store keeps them. Flue 2.3 can carry a PDF
 * too, natively - but only on Anthropic Messages, Google and OpenAI
 * Responses; on any other protocol, OpenRouter's and every self-hosted
 * endpoint's included, the model gets a placeholder saying it was omitted -
 * and Word, PowerPoint and Excel on none. Riding the message would make what
 * the model can read depend on which provider answers. So the harness
 * carries every document the same way, as Hermes Agent does for the same
 * reason: the file is saved where the conversation's file tools can read
 * it, and the model is told, in a note beside the words, that it is there.
 *
 * ---- The two halves ----------------------------------------------------------
 *
 * The composer uploads each document before it sends the words. The upload
 * lands the file in the conversation's `attachments/` folder - the same
 * folder pictures are copied to, so the environment note already names it
 * - reads it once for its page count and coverage, and records a row.
 * Then, when the next user message starts its response, the render's
 * `useAgentStart` asks here for the rows not yet announced and appends one
 * signal naming them; that signal is what the model reads, and what the
 * transcript draws as the message's document chips.
 *
 * ---- Inline or by path -------------------------------------------------------
 *
 * A short document's whole text rides in the signal - the person attached
 * it to be read, and a round trip through the read tool for four pages is
 * ceremony. Past `DOCUMENT_INLINE_CHARS` the signal carries the path, the page
 * count and the coverage, and the model reads what it needs by range or
 * grep; a thousand-page manual costs nothing until a page is opened. The
 * threshold is characters, not bytes: a 30 MB PDF of photographs can be
 * six pages of words, and a 300 KB one can be a whole book.
 *
 * ---- What is deliberately not here --------------------------------------------
 *
 * No extracted-text cache. The read tool extracts on demand, which is
 * seconds even for a long PDF, and a cache keyed by digest is the parked
 * storage work in `documentation/work/documents-and-attachments-plan.md`.
 * And no OCR at upload: a scanned page is reported, never read on its own,
 * because the provider charges per page and the model decides which pages
 * matter.
 */

const DOCUMENT_ID = /^doc_[0-9a-f-]{36}$/;
// eslint-disable-next-line no-control-regex -- removing control characters is the point.
const UNSAFE_IN_A_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

export interface ConversationDocument {
  readonly id: string;
  readonly conversationId: string;
  readonly fileName: string;
  /** Where the file lies, absolute: inside the conversation's attachments folder. */
  readonly path: string;
  readonly mimeType: string;
  readonly byteLength: number;
  /** How many pages, slides or sheets the file gave; 1 for a plain text file. */
  readonly pageCount: number;
  readonly unit: "page" | "slide" | "sheet";
  /** One-based numbers of the pages with no text layer. */
  readonly emptyPages: readonly number[];
  /** The whole text, when it was short enough to ride the signal. */
  readonly inlineText: string | null;
  readonly createdAt: number;
  readonly announcedAt: number | null;
}

export interface DocumentAddition {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** What one announcement carries: the signal's body, and the facts the transcript draws. */
export interface DocumentAnnouncement {
  readonly body: string;
  readonly documents: readonly ConversationDocument[];
}

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIMES = new Set(["application/json", "application/xml", "application/x-yaml"]);

export interface ConversationDocumentStoreOptions {
  readonly now?: () => number;
  /** Where a conversation's files land; the default is the attachments folder. */
  readonly directoryFor?: (conversationId: string) => string;
}

export class ConversationDocumentStore {
  readonly #db: StudioDatabase;
  readonly #now: () => number;
  readonly #directoryFor: (conversationId: string) => string;

  constructor(db: StudioDatabase, options: ConversationDocumentStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
    this.#directoryFor = options.directoryFor ?? conversationAttachmentsDirectory;
  }

  list(conversationId: string): readonly ConversationDocument[] {
    const rows = this.#db
      .prepare("SELECT * FROM conversation_document WHERE conversation_id = ? ORDER BY created_at, rowid")
      .all(conversationId) as Record<string, unknown>[];
    return rows.map(documentOf);
  }

  get(conversationId: string, id: string): ConversationDocument | undefined {
    if (!DOCUMENT_ID.test(id)) return undefined;
    const row = this.#db
      .prepare("SELECT * FROM conversation_document WHERE conversation_id = ? AND id = ?")
      .get(conversationId, id) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : documentOf(row);
  }

  /**
   * Saves the file beside the conversation's pictures and reads it once for
   * what the announcement will say. A file that cannot be read as a
   * document - not the format its name claims - is refused here, with the
   * reader's sentence, so the person hears it at upload and not from the
   * model a turn later.
   */
  async add(conversationId: string, addition: DocumentAddition): Promise<ConversationDocument> {
    if (addition.bytes.byteLength === 0) {
      throw new StorageError("invalid", { message: "The file is empty." });
    }
    if (addition.bytes.byteLength > DOCUMENT_MAX_BYTES) {
      throw new StorageError("invalid", {
        message: `The file is larger than a conversation takes (${String(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB).`,
      });
    }
    const fileName = safeFileName(addition.fileName);
    const mimeType = addition.mimeType.trim().toLowerCase().split(";")[0] ?? "application/octet-stream";
    const format = documentFormatOf(fileName);
    let extracted: ExtractedDocument | undefined;
    let text: string;
    if (format !== undefined) {
      try {
        extracted = await extractDocument(addition.bytes, format);
      } catch (error) {
        if (error instanceof DocumentError) throw new StorageError("invalid", { message: error.message });
        throw error;
      }
      text = renderPages(extracted);
    } else if (isTextMime(mimeType)) {
      // UTF-16 and BOM-led UTF-8 as well as plain UTF-8: decoded as UTF-8
      // alone, a Notepad "Unicode" file was inlined as a run of NULs.
      const decoded = decodeTextBytes(addition.bytes);
      if (decoded === undefined) {
        throw new StorageError("invalid", { message: `${fileName} is named as text but its bytes are not text.` });
      }
      text = decoded.text;
    } else {
      throw new StorageError("invalid", {
        message: `${fileName} is not a document the conversation can read: attach a PDF, Word, PowerPoint, Excel or plain text file.`,
      });
    }
    const directory = ensureDirectory(this.#directoryFor(conversationId));
    const path = vacantPath(directory, fileName, addition.bytes);
    writeFileSync(path, addition.bytes);
    const id = `doc_${createStudioUuid()}`;
    const now = this.#now();
    const document: ConversationDocument = {
      id,
      conversationId,
      fileName: path.slice(directory.length + 1),
      path,
      mimeType,
      byteLength: addition.bytes.byteLength,
      pageCount: extracted?.pages.length ?? 1,
      unit: extracted?.unit ?? "page",
      emptyPages: extracted?.emptyPages ?? [],
      inlineText: text.length <= DOCUMENT_INLINE_CHARS ? text : null,
      createdAt: now,
      announcedAt: null,
    };
    try {
      this.#db
        .prepare(
          `INSERT INTO conversation_document
             (id, conversation_id, file_name, path, mime_type, byte_length, page_count, unit, empty_pages, inline_text, created_at, announced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          conversationId,
          document.fileName,
          path,
          mimeType,
          document.byteLength,
          document.pageCount,
          document.unit,
          JSON.stringify(document.emptyPages),
          document.inlineText,
          now,
        );
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
    return document;
  }

  /**
   * Removes a document the person took back before sending; the file goes
   * with it unless another of the conversation's documents still names it.
   *
   * Two documents share one file when the same bytes are attached twice
   * (`vacantPath` keeps the one copy), so deleting the file with the row
   * took it from the other document too - including one the model had
   * already been told to read. And an announced document is part of what
   * the model was told: removing it would leave a path in the transcript
   * that points at nothing, so it is refused as a conflict, not a miss.
   */
  remove(conversationId: string, id: string): boolean {
    const document = this.get(conversationId, id);
    if (document === undefined) return false;
    if (document.announcedAt !== null) {
      throw new StorageError("conflict", {
        message: "That document was already sent with a message, so it can no longer be taken back.",
      });
    }
    this.#db.prepare("DELETE FROM conversation_document WHERE id = ?").run(id);
    const stillNamed = this.#db
      .prepare("SELECT 1 FROM conversation_document WHERE conversation_id = ? AND path = ? LIMIT 1")
      .get(conversationId, document.path);
    if (stillNamed === undefined) rmSync(document.path, { force: true });
    return true;
  }

  /** The rows a purge takes with the conversation; the tree's removal takes the files. */
  clearConversation(conversationId: string): number {
    return Number(
      this.#db.prepare("DELETE FROM conversation_document WHERE conversation_id = ?").run(conversationId).changes,
    );
  }

  /**
   * Carries one conversation's document rows to a fork.
   *
   * The files themselves travel with the conversation tree copy that
   * `conversations/fork.ts` performs first, so this only rewrites the rows:
   * new ids, the fork's conversation id, paths under the fork's attachments
   * directory, and `announced_at` cleared. Clearing the announcement is what
   * makes the fork honest: the announcement names a path, and the source's
   * paths do not exist in the fork. The fork's next turn announces the
   * documents where they actually are. Rows whose file did not survive the
   * tree copy are left behind rather than pointing at nothing.
   * Called only from `conversations/fork.ts`, after the tree copy.
   */
  duplicateConversation(
    sourceId: string,
    targetId: string,
    targetDirectory: string,
  ): number {
    const rows = this.#db
      .prepare("SELECT * FROM conversation_document WHERE conversation_id = ? ORDER BY created_at, rowid")
      .all(sourceId) as Record<string, unknown>[];
    let copied = 0;
    for (const row of rows) {
      const document = documentOf(row);
      const path = join(targetDirectory, document.fileName);
      let present: boolean;
      try {
        readFileSync(path);
        present = true;
      } catch {
        present = false;
      }
      if (!present) continue;
      const id = `doc_${createStudioUuid()}`;
      this.#db
        .prepare(
          `INSERT INTO conversation_document
             (id, conversation_id, file_name, path, mime_type, byte_length, page_count, unit, empty_pages, inline_text, created_at, announced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          targetId,
          document.fileName,
          path,
          document.mimeType,
          document.byteLength,
          document.pageCount,
          document.unit,
          JSON.stringify(document.emptyPages),
          document.inlineText,
          document.createdAt,
        );
      copied += 1;
    }
    return copied;
  }

  /**
   * The announcement for everything attached since the last one, and the
   * marking of it as announced - one call, because the two are one fact:
   * a document is announced when its words have reached the response.
   * Undefined when there is nothing to say, so the caller appends nothing.
   */
  announce(conversationId: string): DocumentAnnouncement | undefined {
    const pending = this.list(conversationId).filter((document) => document.announcedAt === null);
    if (pending.length === 0) return undefined;
    const now = this.#now();
    const mark = this.#db.prepare("UPDATE conversation_document SET announced_at = ? WHERE id = ?");
    for (const document of pending) mark.run(now, document.id);
    return {
      body: pending.map(announcementOf).join("\n\n"),
      documents: pending.map((document) => ({ ...document, announcedAt: now })),
    };
  }
}

/** What the signal says about one document, in the words the model acts on. */
export function announcementOf(document: ConversationDocument): string {
  const pages = `${String(document.pageCount)} ${document.unit}${document.pageCount === 1 ? "" : "s"}`;
  const head = `The user attached "${document.fileName}" (${pages}, ${sizeOf(document.byteLength)}). It is saved at: ${document.path}`;
  const coverage = coverageLine(document);
  if (document.inlineText !== null) {
    return `${head}\n${coverage}Its text follows.\n\n${document.inlineText}`;
  }
  // The two ways in differ by kind: grep sees only a text file's bytes, and
  // a PDF or Office file is read through read's page selector.
  const how = documentFormatOf(document.fileName) === undefined
    ? "read it with the read tool by offset and limit, or grep it,"
    : `read it with the read tool, passing pages such as "1-5" to read only those ${document.unit}s (grep cannot search inside it),`;
  return (
    `${head}\n${coverage}Its text is not inlined here: ${how} before answering about its contents. ` +
    "Do not ask the user to paste it."
  );
}

/** A size a person would say: "12 KB", "3.4 MB" - never "0.00 MB" for a short note. */
function sizeOf(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function coverageLine(document: ConversationDocument): string {
  if (!needsOcr(document.pageCount, document.emptyPages)) return "";
  const all = document.emptyPages.length === document.pageCount;
  return all
    ? `Every ${document.unit} is a scanned image with no text layer; call ocr with that path to read it.\n`
    : `${document.unit}s ${pageRanges(document.emptyPages)} are scanned images with no text layer; ` +
        `call ocr with that path and pages "${pageRanges(document.emptyPages)}" to read them.\n`;
}

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) || TEXT_MIMES.has(mimeType);
}

function documentOf(row: Record<string, unknown>): ConversationDocument {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    fileName: String(row.file_name),
    path: String(row.path),
    mimeType: String(row.mime_type),
    byteLength: Number(row.byte_length),
    pageCount: Number(row.page_count),
    unit: row.unit === "slide" || row.unit === "sheet" ? row.unit : "page",
    emptyPages: pagesOf(row.empty_pages),
    inlineText: typeof row.inline_text === "string" ? row.inline_text : null,
    createdAt: Number(row.created_at),
    announcedAt: typeof row.announced_at === "number" ? row.announced_at : null,
  };
}

function pagesOf(value: unknown): readonly number[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((page): page is number => typeof page === "number") : [];
  } catch {
    return [];
  }
}

/** The name the file keeps: one directory's worth, delimiter characters out, bounded. */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const cleaned = base.replace(UNSAFE_IN_A_NAME, " ").trim().replace(/\s+/g, " ");
  const fallback = cleaned === "" || cleaned === "." || cleaned === ".." ? "document" : cleaned;
  if (fallback.length <= ATTACHMENT_NAME_MAX_CHARS) return fallback;
  const extension = extname(fallback);
  return fallback.slice(0, ATTACHMENT_NAME_MAX_CHARS - extension.length) + extension;
}

/**
 * The next path in the directory that is either free or already these
 * bytes - the rule the picture copies follow, so a document sent twice is
 * one file and two documents that share a name are two.
 */
function vacantPath(directory: string, name: string, bytes: Uint8Array): string {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  for (let attempt = 0; ; attempt += 1) {
    const numbered = attempt === 0 ? name : `${stem}-${String(attempt + 1)}${extension}`;
    const target = join(directory, numbered);
    let there: Buffer | undefined;
    try {
      there = readFileSync(target);
    } catch {
      there = undefined;
    }
    if (there === undefined) return target;
    if (there.length === bytes.length && there.equals(bytes)) return target;
  }
}
