import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import {
  MAX_MEMORY_CONTENT,
  MEMORY_KINDS,
  MEMORY_SCOPES,
  type MemoryChange,
  type MemoryItem,
  type MemoryKind,
  type MemoryPriority,
  type MemoryScope,
  type MemoryStore,
  type MemoryVisibility,
} from "../../../memory/store.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import { StorageError } from "../../../storage/errors.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * `/api/memory`: the person's profile and saved memories.
 *
 * Two audiences, two route families, one store:
 *
 * - The settings pane (`/profile`, `/settings`, `/items`) is the person, and
 *   sees and edits everything, including other projects' memories.
 * - The `studio-memory` MCP relay (`/conversations/:conversationId/...`)
 *   speaks for the model in one conversation. Its visibility and the project
 *   a `project` memory belongs to are derived here from the conversation's
 *   filing, never read from the body, so a tool argument cannot reach another
 *   project's memories or file a memory under a project it is not in.
 *
 * ---- Batches answer per item ------------------------------------------------
 *
 * Every write takes a list. A batch is not one transaction: each entry is
 * validated and applied on its own and the answer says, entry by entry, what
 * happened. A model that saves five memories and gets one refused (too long,
 * no project) should keep the other four and fix the fifth, not redo all five.
 */

/** How a route learns which project, if any, a conversation is filed under. */
export interface MemoryConversationPort {
  /** `null` when filed under no project; `undefined` when there is no such conversation. */
  conversationProject(conversationId: string): { readonly id: string; readonly name: string } | null | undefined;
  /** Whether a project exists, for a memory the person files by hand. */
  projectExists(projectId: string): boolean;
}

export const MAX_MEMORY_BATCH = 50;

const prioritySchema = v.picklist([1, 2, 3]);
const tagsSchema = v.pipe(v.array(v.pipe(v.string(), v.maxLength(64))), v.maxLength(16));
const contentSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_MEMORY_CONTENT * 2));
const idSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(80));

const draftSchema = v.object({
  content: contentSchema,
  kind: v.picklist(MEMORY_KINDS),
  scope: v.optional(v.picklist(MEMORY_SCOPES)),
  tags: v.optional(tagsSchema),
  priority: v.optional(prioritySchema),
  /** Read only on the person's routes; the conversation routes derive it. */
  projectId: v.optional(v.nullable(v.string())),
});

const changeSchema = v.object({
  id: idSchema,
  content: v.optional(contentSchema),
  kind: v.optional(v.picklist(MEMORY_KINDS)),
  tags: v.optional(tagsSchema),
  priority: v.optional(prioritySchema),
  scope: v.optional(v.picklist(MEMORY_SCOPES)),
  projectId: v.optional(v.nullable(v.string())),
});

const saveBatchSchema = v.object({ items: v.pipe(v.array(draftSchema), v.minLength(1), v.maxLength(MAX_MEMORY_BATCH)) });
const updateBatchSchema = v.object({ changes: v.pipe(v.array(changeSchema), v.minLength(1), v.maxLength(MAX_MEMORY_BATCH)) });
const forgetBatchSchema = v.object({ ids: v.pipe(v.array(idSchema), v.minLength(1), v.maxLength(MAX_MEMORY_BATCH)) });

const profileSchema = v.object({
  name: v.optional(v.string()),
  preferredName: v.optional(v.string()),
  about: v.optional(v.string()),
  replyStyle: v.optional(v.string()),
});

const settingsSchema = v.object({ enabled: v.optional(v.boolean()) });

type Draft = v.InferOutput<typeof draftSchema>;
type Change = v.InferOutput<typeof changeSchema>;

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
    const issue = result.issues[0];
    const path = issue.path?.map((segment) => String(segment.key)).join(".");
    throw refused(
      path === undefined || path === ""
        ? "The request body does not match what this route takes."
        : `The field ${path} is not valid: ${issue.message}`,
    );
  }
  return result.output;
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

function statusOf(error: unknown): 400 | 404 | 503 {
  if (error instanceof StorageError) {
    if (error.kind === "not_found") return 404;
    if (error.kind === "invalid") return 400;
  }
  return 503;
}

/** The memory as the wire carries it. */
export function wireMemory(item: MemoryItem): Record<string, unknown> {
  return {
    id: item.id,
    scope: item.scope,
    projectId: item.projectId,
    kind: item.kind,
    content: item.content,
    tags: item.tags,
    priority: item.priority,
    author: item.author,
    sourceConversationId: item.sourceConversationId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function kindOf(value: string | undefined): MemoryKind | undefined {
  return MEMORY_KINDS.find((kind) => kind === value);
}

function scopeOf(value: string | undefined): MemoryScope | undefined {
  return MEMORY_SCOPES.find((scope) => scope === value);
}

function limitOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function priorityOf(value: number | undefined): MemoryPriority | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

/** One entry's outcome; the message is the store's, written for the reader. */
function entryFailure(error: unknown): { readonly ok: false; readonly error: string } {
  if (error instanceof StorageError && (error.kind === "invalid" || error.kind === "not_found")) {
    return { ok: false, error: error.message };
  }
  // Anything else is the store failing, not this entry being wrong: the
  // whole request answers it, so a broken database is never reported as a
  // list of individually refused memories.
  throw error;
}

/** Who is writing, and what they may see and file under. */
interface Writer {
  readonly author: "model" | "user";
  readonly visibility: MemoryVisibility;
  /** The project a `project` entry is filed under, or how the person names one. */
  readonly projectFor: (requested: string | null | undefined) => string | null;
  readonly sourceConversationId: string | null;
}

function saveAll(store: MemoryStore, writer: Writer, drafts: readonly Draft[]): Record<string, unknown>[] {
  return drafts.map((draft) => {
    try {
      const scope = draft.scope ?? "personal";
      const priority = priorityOf(draft.priority);
      const saved = store.save({
        content: draft.content,
        kind: draft.kind,
        scope,
        projectId: scope === "project" ? writer.projectFor(draft.projectId) : null,
        author: writer.author,
        sourceConversationId: writer.sourceConversationId,
        ...(draft.tags === undefined ? {} : { tags: draft.tags }),
        ...(priority === undefined ? {} : { priority }),
      });
      return {
        ok: true,
        existed: saved.existed,
        item: wireMemory(saved.item),
        similar: saved.similar.map(wireMemory),
      };
    } catch (error) {
      return entryFailure(error);
    }
  });
}

function updateAll(store: MemoryStore, writer: Writer, changes: readonly Change[]): Record<string, unknown>[] {
  return changes.map((change) => {
    try {
      const priority = priorityOf(change.priority);
      const update: MemoryChange = {
        ...(change.content === undefined ? {} : { content: change.content }),
        ...(change.kind === undefined ? {} : { kind: change.kind }),
        ...(change.tags === undefined ? {} : { tags: change.tags }),
        ...(priority === undefined ? {} : { priority }),
        ...(change.scope === undefined
          ? {}
          : {
              scope: change.scope,
              projectId: change.scope === "project" ? writer.projectFor(change.projectId) : null,
            }),
      };
      return { ok: true, item: wireMemory(store.update(change.id, update, writer.visibility)) };
    } catch (error) {
      return { id: change.id, ...entryFailure(error) };
    }
  });
}

function forgetAll(store: MemoryStore, writer: Writer, ids: readonly string[]): Record<string, unknown>[] {
  return [...new Set(ids)].map((id) =>
    store.forget(id, writer.visibility) ? { id, ok: true } : { id, ok: false, error: `There is no memory ${id} here.` },
  );
}

export function createMemoryRoutes(store: MemoryStore, conversations: MemoryConversationPort): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));

  // ---- The person's routes, from Settings - Personalization ---------------

  const person: Writer = {
    author: "user",
    visibility: { everything: true },
    projectFor: (requested) => {
      if (requested === undefined || requested === null || requested === "") {
        throw refused("Choose the project this memory belongs to.");
      }
      if (!conversations.projectExists(requested)) throw refused("There is no such project to file this memory under.");
      return requested;
    },
    sourceConversationId: null,
  };

  routes.get("/profile", (context) => context.json({ profile: store.profile() }));

  routes.put("/profile", async (context) => {
    try {
      const parsed = await body(context, profileSchema);
      return context.json({ profile: store.setProfile(parsed) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.get("/settings", (context) => context.json({ settings: store.settings() }));

  routes.put("/settings", async (context) => {
    try {
      const parsed = await body(context, settingsSchema);
      return context.json({ settings: store.setSettings(parsed) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.get("/items", (context) => {
    try {
      const query = context.req.query("query");
      const kind = kindOf(context.req.query("kind"));
      const scope = scopeOf(context.req.query("scope"));
      const limit = limitOf(context.req.query("limit"));
      const items = store.list({
        everything: true,
        ...(query === undefined ? {} : { query }),
        ...(kind === undefined ? {} : { kind }),
        ...(scope === undefined ? {} : { scope }),
        ...(limit === undefined ? {} : { limit }),
      });
      return context.json({ items: items.map(wireMemory), total: store.count() });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/items", async (context) => {
    try {
      const parsed = await body(context, saveBatchSchema);
      return context.json({ results: saveAll(store, person, parsed.items) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.patch("/items", async (context) => {
    try {
      const parsed = await body(context, updateBatchSchema);
      return context.json({ results: updateAll(store, person, parsed.changes) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/items/forget", async (context) => {
    try {
      const parsed = await body(context, forgetBatchSchema);
      return context.json({ results: forgetAll(store, person, parsed.ids) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // ---- The model's routes, through the studio-memory relay -----------------

  const unknownConversation = (): StorageError =>
    new StorageError("not_found", {
      message: "Memory tools work inside a Studio conversation, and this call did not come from one.",
    });

  /** What one conversation may see and file under, or undefined when it does not exist. */
  const modelWriter = (conversationId: string):
    | { readonly writer: Writer; readonly project: { readonly id: string; readonly name: string } | null }
    | undefined => {
    const project = conversations.conversationProject(conversationId);
    if (project === undefined) return undefined;
    return {
      project,
      writer: {
        author: "model",
        visibility: project === null ? {} : { projectId: project.id },
        // The body's `projectId` is ignored here on purpose: the filing is
        // the conversation's, and `null` makes the store refuse a project
        // entry from a conversation filed nowhere.
        projectFor: () => project?.id ?? null,
        sourceConversationId: conversationId,
      },
    };
  };

  routes.get("/conversations/:conversationId/items", (context) => {
    const scope = modelWriter(context.req.param("conversationId"));
    if (scope === undefined) return context.json(failure(unknownConversation()), 404);
    try {
      const query = context.req.query("query");
      const kind = kindOf(context.req.query("kind"));
      const only = scopeOf(context.req.query("scope"));
      const limit = limitOf(context.req.query("limit"));
      const items = store.list({
        ...scope.writer.visibility,
        ...(query === undefined ? {} : { query }),
        ...(kind === undefined ? {} : { kind }),
        ...(only === undefined ? {} : { scope: only }),
        ...(limit === undefined ? {} : { limit }),
      });
      return context.json({
        items: items.map(wireMemory),
        total: store.count(scope.writer.visibility),
        project: scope.project,
      });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/conversations/:conversationId/items", async (context) => {
    const scope = modelWriter(context.req.param("conversationId"));
    if (scope === undefined) return context.json(failure(unknownConversation()), 404);
    try {
      const parsed = await body(context, saveBatchSchema);
      return context.json({ results: saveAll(store, scope.writer, parsed.items), project: scope.project });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.patch("/conversations/:conversationId/items", async (context) => {
    const scope = modelWriter(context.req.param("conversationId"));
    if (scope === undefined) return context.json(failure(unknownConversation()), 404);
    try {
      const parsed = await body(context, updateBatchSchema);
      return context.json({ results: updateAll(store, scope.writer, parsed.changes), project: scope.project });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/conversations/:conversationId/items/forget", async (context) => {
    const scope = modelWriter(context.req.param("conversationId"));
    if (scope === undefined) return context.json(failure(unknownConversation()), 404);
    try {
      const parsed = await body(context, forgetBatchSchema);
      return context.json({ results: forgetAll(store, scope.writer, parsed.ids), project: scope.project });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.get("/conversations/:conversationId/profile", (context) => {
    if (modelWriter(context.req.param("conversationId")) === undefined) {
      return context.json(failure(unknownConversation()), 404);
    }
    return context.json({ profile: store.profile() });
  });

  routes.put("/conversations/:conversationId/profile", async (context) => {
    if (modelWriter(context.req.param("conversationId")) === undefined) {
      return context.json(failure(unknownConversation()), 404);
    }
    try {
      const parsed = await body(context, profileSchema);
      return context.json({ profile: store.setProfile(parsed) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}
