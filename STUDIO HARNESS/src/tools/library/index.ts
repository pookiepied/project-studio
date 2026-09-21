import { NATIVE_PROVENANCE, type CapabilityDescriptor } from "../../contracts/capabilities.js";
import type { LibraryItem, LibraryKind, LibraryStore } from "../../library/store.js";
import { StorageError } from "../../storage/errors.js";
import { ToolError } from "../errors.js";
import type { CallGate } from "../gate.js";
import { defineStudioTool, type ToolContext, type ToolDefinition } from "../types.js";

/**
 * The library, as the model reaches it: one tool that finds, one that keeps.
 *
 * ---- Why a search tool and not a listing in the prompt ---------------------
 *
 * A library grows, and every item named in the system block would be a
 * line in the cached prefix of every request, for every conversation, for
 * ever. So the block names the folder and this tool, and the model asks
 * when the person's words point at something kept: "my photo", "our
 * logo", "the contract from last week". The answer is the record and the
 * absolute path, and the path is the point - the library folder is a read
 * root of every conversation, so the next call can be `read` (to look at
 * the picture or work from the document) or `studio_image` (to edit it).
 *
 * ---- Why the answer carries the subject ------------------------------------
 *
 * The subject is the person's own label - "me", "Bruno", "the logo" - and
 * it is how a search for "my photo" is answered honestly: the item whose
 * subject the person set to "me" is theirs by their own word, and nothing
 * here has looked at a face to decide it.
 *
 * ---- `library_keep` ----------------------------------------------------------
 *
 * "Keep this" said in a chat about a file the conversation can already
 * reach - a generated picture, a document in the workspace - files it
 * with a title, a subject and tags. It declares `write` and is treated as
 * a command by the kernel, so in Ask mode the person is asked, which is
 * the same yes the Settings page's dialog collects.
 */

const KINDS: readonly LibraryKind[] = ["image", "document", "audio", "video", "other"];

const SEARCH_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "library_search" },
  title: "Search the library",
  description:
    "Finds files the user keeps in their library - photos, documents and other files saved " +
    "for reuse across conversations - by words, kind, subject or tag. When the user refers to " +
    'something of theirs ("my photo", "our logo", "the contract I saved"), look here first. ' +
    "Each result carries the file's absolute path: hand it to read to look at a picture or " +
    "work from a document, or to studio_image to edit it. The subject is the user's own label " +
    "for who or what the file shows. Call with no arguments to see what is kept.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to match against titles, descriptions, subjects, tags and file names." },
      kind: { type: "string", enum: [...KINDS] },
      subject: { type: "string", description: 'The user\'s label for who or what it is, such as "me" or "logo".' },
      tag: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

const KEEP_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "library_keep" },
  title: "Keep a file in the library",
  description:
    "Saves a copy of a file this conversation can read - a generated image, a document in the " +
    "workspace - into the user's library, so later conversations can find it. Give a short " +
    "title, the subject in the user's own words when they said one (who or what it is), and " +
    "a few tags. Use it when the user asks to keep, save or remember a file, not on your own.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      title: { type: "string", maxLength: 120 },
      description: { type: "string", maxLength: 2000 },
      subject: { type: "string", maxLength: 80 },
      tags: { type: "array", items: { type: "string" }, maxItems: 24 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  effects: ["write"],
  provenance: NATIVE_PROVENANCE,
  idempotent: false,
};

export interface LibrarySearchInput {
  readonly query?: string;
  readonly kind?: LibraryKind;
  readonly subject?: string;
  readonly tag?: string;
  readonly limit?: number;
}

export interface LibraryKeepInput {
  readonly path: string;
  readonly title?: string;
  readonly description?: string;
  readonly subject?: string;
  readonly tags?: readonly string[];
}

export interface LibraryToolOutput {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
}

const DEFAULT_RESULTS = 20;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
};

function optionalText(value: unknown, name: string, max = 2_000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolError("invalid_input", { message: `${name} must be text.` });
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, max);
}

/** One item as the model reads it: what it is, whose it is, where it is. */
export function itemLines(item: LibraryItem): string {
  const lines = [`- ${item.title} (${item.kind}, ${item.fileName}, id ${item.id})`];
  if (item.subject !== "") lines.push(`  Subject: ${item.subject}`);
  if (item.description !== "") lines.push(`  ${item.description}`);
  if (item.tags.length > 0) lines.push(`  Tags: ${item.tags.join(", ")}`);
  lines.push(`  Path: ${item.path}`);
  return lines.join("\n");
}

function createSearchTool(store: LibraryStore): ToolDefinition<LibrarySearchInput, LibraryToolOutput> {
  return defineStudioTool({
    descriptor: SEARCH_DESCRIPTOR,
    resourceKind: "command",
    // No resource of its own: the library is the person's, read-only to
    // the conversation, and a search touches no file.
    resource: () => undefined,

    parse: (input): LibrarySearchInput => {
      const value = (input ?? {}) as Record<string, unknown>;
      const kind = optionalText(value.kind, "kind");
      if (kind !== undefined && !KINDS.includes(kind as LibraryKind)) {
        throw new ToolError("invalid_input", { message: `kind must be one of ${KINDS.join(", ")}.` });
      }
      const limit = value.limit;
      if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50)) {
        throw new ToolError("invalid_input", { message: "limit must be a whole number from 1 to 50." });
      }
      const query = optionalText(value.query, "query", 200);
      const subject = optionalText(value.subject, "subject", 80);
      const tag = optionalText(value.tag, "tag", 40);
      return {
        ...(query === undefined ? {} : { query }),
        ...(kind === undefined ? {} : { kind: kind as LibraryKind }),
        ...(subject === undefined ? {} : { subject }),
        ...(tag === undefined ? {} : { tag }),
        ...(limit === undefined ? {} : { limit }),
      };
    },

    execute: async (input) => {
      const items = store.list({ ...input, limit: input.limit ?? DEFAULT_RESULTS });
      const filtered = Object.keys(input).length > 0;
      if (items.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: filtered
                ? "Nothing in the library matches. Try fewer words, or call with no arguments to see everything kept."
                : "The library is empty. The user keeps files there from the composer, from a message's picture, or from Settings > Library.",
            },
          ],
        };
      }
      const head = `${String(items.length)} item${items.length === 1 ? "" : "s"}${filtered ? " match" : " in the library"}. ` +
        "Paths are readable here: use read to look at a picture or work from a document, studio_image to edit a picture.";
      return { content: [{ type: "text", text: [head, "", ...items.map(itemLines)].join("\n") }] };
    },
  });
}

function createKeepTool(store: LibraryStore): ToolDefinition<LibraryKeepInput, LibraryToolOutput> {
  return defineStudioTool({
    descriptor: KEEP_DESCRIPTOR,
    resourceKind: "path",
    resource: (input, context) => context.sandbox.resolveRead(input.path),

    parse: (input): LibraryKeepInput => {
      const value = (input ?? {}) as Record<string, unknown>;
      const path = optionalText(value.path, "path", 4_000);
      if (path === undefined) throw new ToolError("invalid_input", { message: "path is required." });
      const tags = value.tags;
      if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))) {
        throw new ToolError("invalid_input", { message: "tags must be a list of words." });
      }
      const title = optionalText(value.title, "title", 120);
      const description = optionalText(value.description, "description");
      const subject = optionalText(value.subject, "subject", 80);
      return {
        path,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(subject === undefined ? {} : { subject }),
        ...(tags === undefined ? {} : { tags: tags as string[] }),
      };
    },

    execute: async (input, context: ToolContext) => {
      const resolved = context.sandbox.resolveRead(input.path);
      const extension = resolved.slice(resolved.lastIndexOf(".") + 1).toLowerCase();
      try {
        const item = store.addFromPath(resolved, {
          mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
          sourceConversationId: context.scope.conversationId,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
        });
        return {
          content: [{ type: "text", text: `Kept in the library.\n${itemLines(item)}` }],
        };
      } catch (error) {
        if (error instanceof StorageError) {
          throw new ToolError(error.kind === "invalid" ? "invalid_input" : "execution_failed", {
            message: error.message,
          });
        }
        throw error;
      }
    },
  });
}

export function registerLibraryTools(gate: CallGate, store: LibraryStore): void {
  gate.register(createSearchTool(store));
  gate.register(createKeepTool(store));
}
