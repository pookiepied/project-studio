import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { DescribeError, type ImageDescriberPort } from "../../../library/describer.js";
import { MAX_LIBRARY_FILE_BYTES, type LibraryItem, type LibraryKind, type LibraryStore } from "../../../library/store.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import { StorageError } from "../../../storage/errors.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * `/api/library`: the files the person keeps, and the model's proposal for
 * a picture's label.
 *
 * The bytes travel as base64 in JSON both ways, like a turn's images: the
 * webview already holds an attachment that way, and one shape for every
 * caller beats a multipart parser for a route that takes one file at a
 * time. The item's path is returned to the webview as a fact about where
 * the file lives ("Open folder"), never as something it reads through.
 */

const KINDS: readonly LibraryKind[] = ["image", "document", "audio", "video", "other"];

const factsSchema = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  subject: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
});

const addSchema = v.object({
  ...factsSchema.entries,
  fileName: v.pipe(v.string(), v.minLength(1)),
  mimeType: v.pipe(v.string(), v.minLength(1)),
  /** The bytes, base64; a leading `data:` prefix is accepted. */
  data: v.pipe(v.string(), v.minLength(1)),
  sourceConversationId: v.optional(v.nullable(v.string())),
});

const describeSchema = v.object({
  data: v.pipe(v.string(), v.minLength(1)),
  mimeType: v.pipe(v.string(), v.minLength(1)),
  hint: v.optional(v.string()),
});

/** A body that failed its contract: a storage `invalid`, the 400 below. */
function refused(message: string): StorageError {
  return new StorageError("invalid", { message });
}

async function body<T>(context: { req: { json(): Promise<unknown> } }, schema: v.GenericSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await context.req.json();
  } catch {
    throw refused("The request body must be valid JSON.");
  }
  const result = v.safeParse(schema, raw);
  if (!result.success) {
    throw refused("The request body does not match what this route takes.");
  }
  return result.output;
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

function statusOf(error: unknown): 400 | 404 | 413 | 502 | 503 {
  if (error instanceof StorageError) {
    if (error.kind === "not_found") return 404;
    if (error.kind === "invalid") return 400;
    return 503;
  }
  if (error instanceof DescribeError) return error.kind === "bad-input" ? 400 : 502;
  return 503;
}

/** Base64 arrives in JSON; a `data:` URL prefix is tolerated and dropped. */
function decoded(data: string): Buffer {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  return Buffer.from(comma === -1 ? data : data.slice(comma + 1), "base64");
}

/** The item as the wire carries it. */
export function wireItem(item: LibraryItem): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    fileName: item.fileName,
    mimeType: item.mimeType,
    byteLength: item.byteLength,
    title: item.title,
    description: item.description,
    subject: item.subject,
    tags: item.tags,
    sourceConversationId: item.sourceConversationId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    path: item.path,
  };
}

function kindOf(value: string | undefined): LibraryKind | undefined {
  return KINDS.find((kind) => kind === value);
}

export function createLibraryRoutes(
  store: LibraryStore,
  options: { readonly describer?: ImageDescriberPort } = {},
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));

  routes.get("/", (context) => {
    const limitRaw = context.req.query("limit");
    const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
    const kind = kindOf(context.req.query("kind"));
    const query = context.req.query("query");
    const subject = context.req.query("subject");
    const tag = context.req.query("tag");
    try {
      const items = store.list({
        ...(query === undefined ? {} : { query }),
        ...(kind === undefined ? {} : { kind }),
        ...(subject === undefined ? {} : { subject }),
        ...(tag === undefined ? {} : { tag }),
        ...(limit === undefined || Number.isNaN(limit) ? {} : { limit }),
      });
      return context.json({
        items: items.map(wireItem),
        subjects: store.subjects(),
        directory: store.directory,
        maxFileBytes: MAX_LIBRARY_FILE_BYTES,
      });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/describe", async (context) => {
    try {
      const parsed = await body(context, describeSchema);
      if (options.describer === undefined) {
        throw new DescribeError("model-failed", "Nothing in this harness describes images.");
      }
      const description = await options.describer.describe({
        data: parsed.data,
        mimeType: parsed.mimeType,
        ...(parsed.hint === undefined ? {} : { hint: parsed.hint }),
      });
      return context.json({ description }, 200);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/", async (context) => {
    try {
      const parsed = await body(context, addSchema);
      const bytes = decoded(parsed.data);
      if (bytes.byteLength > MAX_LIBRARY_FILE_BYTES) {
        return context.json(
          failure(refused(`The file is larger than the library takes (${String(MAX_LIBRARY_FILE_BYTES / (1024 * 1024))} MB).`)),
          413,
        );
      }
      const item = store.add({
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        bytes,
        ...(parsed.title === undefined ? {} : { title: parsed.title }),
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        ...(parsed.subject === undefined ? {} : { subject: parsed.subject }),
        ...(parsed.tags === undefined ? {} : { tags: parsed.tags }),
        sourceConversationId: parsed.sourceConversationId ?? null,
      });
      return context.json({ item: wireItem(item) }, 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.get("/:id", (context) => {
    const item = store.get(context.req.param("id"));
    if (item === undefined) {
      return context.json(failure(new StorageError("not_found", { message: "There is no such library item." })), 404);
    }
    return context.json({ item: wireItem(item) });
  });

  /** The bytes, for thumbnails and previews; immutable under the id. */
  routes.get("/:id/bytes", (context) => {
    const found = store.read(context.req.param("id"));
    if (found === undefined) {
      return context.json(failure(new StorageError("not_found", { message: "There is no such library item." })), 404);
    }
    return new Response(new Uint8Array(found.bytes), {
      status: 200,
      headers: {
        "content-type": found.item.mimeType,
        "content-length": String(found.bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  });

  routes.put("/:id", async (context) => {
    try {
      const parsed = await body(context, factsSchema);
      const item = store.update(context.req.param("id"), {
        ...(parsed.title === undefined ? {} : { title: parsed.title }),
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        ...(parsed.subject === undefined ? {} : { subject: parsed.subject }),
        ...(parsed.tags === undefined ? {} : { tags: parsed.tags }),
      });
      return context.json({ item: wireItem(item) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.delete("/:id", (context) => {
    try {
      if (!store.remove(context.req.param("id"))) {
        return context.json(failure(new StorageError("not_found", { message: "There is no such library item." })), 404);
      }
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}
