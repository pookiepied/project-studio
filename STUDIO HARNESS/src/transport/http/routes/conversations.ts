import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import {
  conversationCreateSchema,
  conversationPatchSchema,
} from "../../../contracts/conversations.js";
import { ExtensionSelectionStore } from "../../../extend/selection.js";
import { PermissionGrantStore } from "../../../permissions/grant-store.js";
import { PlanItemStore } from "../../../plan/plan-items.js";
import { PendingQuestionStore } from "../../../questions/pending-questions.js";
import { SandboxScopeStore } from "../../../sandbox/scope-store.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import {
  listOrphanConversationTrees,
  purgeConversations,
  sweepOrphanConversationTrees,
} from "../../../conversations/purge.js";
import { forkConversation } from "../../../conversations/fork.js";
import type { ConversationStore } from "../../../conversations/store.js";
import { ConversationDocumentStore, type ConversationDocument } from "../../../conversations/documents.js";
import type { ConversationUsage } from "../../../conversations/context-usage.js";
import type { CompactionReadiness } from "../../../conversations/compaction.js";
import type { JobStatus } from "../../../process/background.js";
import type { StudioDatabase } from "../../../storage/database.js";
import { StorageError } from "../../../storage/errors.js";
import { resolveFlueJournalPath } from "../../../storage/flue-journal.js";
import type { ConversationSnapshots } from "../../../snapshots/store.js";
import { TaskStore } from "../../../agents/definitions/task-store.js";
import { failure, invalidBody, statusOf } from "./error-status.js";
import { browserInteractionSchema, type BrowserInteraction } from "../../../browser/interaction.js";

export interface ConversationRoutesOptions {
  readonly queuedMessages?: (conversationId: string, submissionId: string | null, action: "list" | "steer" | "remove" | "edit") => Promise<unknown>;
  /** The index of conversations that exist, and the one owner of its rows. */
  readonly conversations: ConversationStore;
  /** The application database, for the conversation-scoped purge writes. */
  readonly database: StudioDatabase;
  /**
   * The measured context usage per conversation, when the runtime is watching
   * for it. Absent in a composition with no Flue behind it - the route then
   * answers "nothing measured", which is what the webview already handles.
   */
  readonly contextUsage?: {
    get(conversationId: string): ConversationUsage | undefined;
    /**
     * Drops a conversation's figure when the conversation goes. The tracker
     * owns its table (one owner per table, 008.3-05), so the purge cannot
     * cascade it in SQL and asks here instead.
     */
    forget?(conversationId: string): void;
    /**
     * Carries a conversation's figure to its fork, for the same ownership
     * reason: the fork cannot insert into a table it does not own.
     */
    duplicate?(sourceId: string, targetId: string): void;
  };
  /**
   * Compacting a conversation by hand, and whether it may be done now. The
   * readiness travels with the measurement so the meter's "Compact now" can
   * be disabled with its reason in the same read; the action is its own
   * route. Absent means no manual compaction, which a composition without a
   * runtime wants and production must not be.
   */
  readonly compaction?: {
    readiness(conversationId: string): CompactionReadiness;
    compact(conversationId: string): Promise<void>;
  };
  /**
   * The undo surface: one conversation's snapshot history and the restore
   * that returns its project to a recorded point. The store behind the port
   * is the runtime's own, so a restore joins the same queue the gate's
   * captures run on. Optional like `compaction` — a composition with no
   * runtime has no history to answer with, and the routes say so rather
   * than pretending — and production always wires it, because an undo
   * nobody can reach does not back the safety story Auto runs on.
   */
  readonly snapshots?: ConversationSnapshots;
  /**
   * The background commands, for the panel that shows them.
   *
   * Read-only plus a stop, and scoped by conversation the same way the tool
   * is: the panel may only see and end what this conversation started.
   * Absent in a composition with no runtime behind it, and the routes then
   * answer an empty list rather than failing - a window with no jobs to show
   * is the normal case, not an error.
   */
  readonly backgroundJobs?: {
    list(conversationId: string): readonly JobStatus[];
    get(conversationId: string, id: string): JobStatus | undefined;
    stop(conversationId: string, id: string): boolean;
  };
  /**
   * The person's stop for a conversation's browser (ADR 0049 §4).
   *
   * Not a background command: the process belongs to the browser server, so
   * the stop is a call to it rather than a signal from here. Absent in a
   * composition with no runtime, and the route then answers "nothing was
   * running", which is true.
   */
  readonly browser?: {
    stop(conversationId: string): Promise<boolean>;
    interact?(conversationId: string, input: BrowserInteraction): Promise<unknown>;
  };
  /**
   * The person's stop for a conversation's computer control (ADR 0055 §7):
   * the driver is ended and anything it held is released. The same shape as
   * the browser's, for the same reason.
   */
  readonly computer?: {
    stop(conversationId: string): Promise<boolean>;
  };
}

/**
 * Parses a request body without trusting it. `conversationCreateSchema` and
 * `conversationPatchSchema` both strip unknown keys, so a body carrying more
 * than the contract names cannot smuggle a field into the store.
 */
function parseBody<T>(schema: v.GenericSchema<T>, value: unknown): T {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    throw invalidBody("The conversation body does not match the contract.");
  }
  return result.output;
}

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw invalidBody("The request body must be valid JSON.");
  }
}

const purgeBodySchema = v.object({ ids: v.array(v.pipe(v.string(), v.minLength(1))) });

const forkBodySchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  upToSubmissionId: v.optional(v.pipe(v.string(), v.minLength(1))),
});

const documentUploadSchema = v.object({
  fileName: v.pipe(v.string(), v.minLength(1)),
  mimeType: v.pipe(v.string(), v.minLength(1)),
  /** The bytes, base64; a leading `data:` prefix is accepted. */
  data: v.pipe(v.string(), v.minLength(1)),
});

/** Base64 arrives in JSON; a `data:` URL prefix is tolerated and dropped. */
function decodedBase64(data: string): Buffer {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  return Buffer.from(comma === -1 ? data : data.slice(comma + 1), "base64");
}

function idsForPurge(value: unknown): readonly string[] {
  const parsed = v.safeParse(purgeBodySchema, value);
  if (!parsed.success) {
    throw invalidBody("A purge takes an array of conversation ids.");
  }
  return parsed.output.ids;
}

/**
 * The conversation index over HTTP.
 *
 * Every route requires the `project` admission scope: filing is product state,
 * one step removed from running turns, and the client types table already
 * decided who may hold this scope (`admission/scopes.ts`).
 */
export function createConversationRoutes(
  options: ConversationRoutesOptions,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));
  const store = options.conversations;
  routes.get("/:id/queue", async (context) => {
    if (store.get(context.req.param("id")) === undefined) return context.json({ error: { code: "not_found", message: "Conversation not found." } }, 404);
    return context.json(await options.queuedMessages?.(context.req.param("id"), null, "list") ?? []);
  });
  routes.post("/:id/queue/:submissionId/:action", async (context) => {
    const action = context.req.param("action");
    if (action !== "steer" && action !== "remove" && action !== "edit") throw invalidBody("Unknown queue action.");
    const changed = await options.queuedMessages?.(context.req.param("id"), context.req.param("submissionId"), action);
    if (changed === false || changed === undefined) return context.json({ error: { code: "queue_changed", message: "This message has already started or left the queue." } }, 409);
    if (action === "edit") return context.json(changed);
    return context.body(null, 204);
  });
  const grants = new PermissionGrantStore(options.database);
  const selection = new ExtensionSelectionStore(options.database);
  const plans = new PlanItemStore(options.database);
  const questions = new PendingQuestionStore(options.database);
  const folders = new SandboxScopeStore(options.database);
  const documents = new ConversationDocumentStore(options.database);
  // The task index, for the purge: a conversation's rows go the way its
  // grants and questions go - with the conversation they were indexed under.
  const tasks = new TaskStore(options.database);

  routes.get("/", (context) => {
    try {
      const archived = context.req.query("archived");
      // Absent means everything; true or false filters; anything else answers
      // everything rather than guessing.
      const filter =
        archived === "true" ? true : archived === "false" ? false : null;
      const project = context.req.query("project");
      return context.json(
        store.list({
          archived: filter,
          ...(project === undefined || project === "" ? {} : { projectId: project }),
        }),
      );
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Creation happens on an admission receipt, never before it: a first send
  // the harness refuses reaches no route here at all, and a record created by
  // hand for an id no stream answers to stays possible and never load-bearing.
  /**
   * What one conversation's last turn actually sent.
   *
   * A read of a measurement, not of the index, so it is a route of its own
   * rather than a field on the record: the number changes on every model
   * request while the row it would hang off changes on none of them, and
   * folding it in would make every conversation list carry a figure that is
   * stale by the time it is rendered.
   *
   * A conversation nobody has measured answers 200 with a null rather than
   * 404. It is a real and ordinary state - a conversation whose first reply
   * has not landed - and the caller's job in that case is to fall back to
   * its estimate, which is not an error path. A restart is no longer such a
   * state: the figure is stored, and comes back with the process.
   */
  routes.get("/:id/context", (context) => {
    const id = context.req.param("id");
    const measured = options.contextUsage?.get(id);
    const compact = options.compaction?.readiness(id) ?? null;
    return context.json({ usage: measured ?? null, compact });
  });

  /**
   * Compacts one conversation now. 409 with the reason when the cool-down or
   * a running turn refuses it; 200 once the record is written. The call
   * lasts as long as the summariser takes, which is the honest shape: the
   * caller is waiting for exactly that.
   */
  routes.post("/:id/compact", async (context) => {
    if (options.compaction === undefined) {
      return context.json(
        failure(new StorageError("unavailable", { message: "Compaction is not available." })),
        503,
      );
    }
    try {
      await options.compaction.compact(context.req.param("id"));
      return context.json({ compacted: true });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  /**
   * The undo history of the project this conversation writes to, and the one
   * action on it, behind the same `project` scope as the index: the history
   * is project state, and a restore is the person acting on their own files,
   * not a run asking permission. The port resolves to the runtime's own
   * store — the same instance the gate's captures run on — so a restore
   * joins the capture queue instead of racing it.
   *
   * Recorded on every write-bearing turn since snapshots existed and
   * reachable by nothing until now (register #86): under Auto, "you can undo
   * it" is the safety story, and an undo nobody can reach does not back it.
   * An unknown conversation answers 404 before the port is touched, because
   * resolving an undo store for an id nobody owns would mint an empty shadow
   * repository for it — a quieter corruption than a wrong restore, but the
   * same kind.
   */
  routes.get("/:id/snapshots", async (context) => {
    const id = context.req.param("id");
    if (store.get(id) === undefined) {
      return context.json(
        failure(new StorageError("not_found", { message: `No conversation "${id}".` })),
        404,
      );
    }
    if (options.snapshots === undefined) {
      return context.json(
        failure(new StorageError("unavailable", { message: "Undo is not available." })),
        503,
      );
    }
    try {
      return context.json(await options.snapshots.list(id));
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  /**
   * Returns the conversation's project to a recorded point. The state being
   * left behind is captured first — undo that cannot itself be undone is a
   * second way to lose work — and comes back as `undo`, so the caller can
   * say what just happened and offer to take it back.
   */
  routes.post("/:id/snapshots/:snapshotId/restore", async (context) => {
    const id = context.req.param("id");
    if (store.get(id) === undefined) {
      return context.json(
        failure(new StorageError("not_found", { message: `No conversation "${id}".` })),
        404,
      );
    }
    if (options.snapshots === undefined) {
      return context.json(
        failure(new StorageError("unavailable", { message: "Undo is not available." })),
        503,
      );
    }
    try {
      return context.json(
        await options.snapshots.restore(id, context.req.param("snapshotId")),
      );
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  /**
   * One conversation's background commands, with their output.
   *
   * The output is included in the listing rather than behind a second call:
   * the panel shows it, the tail is already bounded to a few hundred lines,
   * and a second round trip per job would make a list of five jobs six
   * requests to render one panel.
   */
  routes.get("/:id/jobs", (context) =>
    context.json({ jobs: options.backgroundJobs?.list(context.req.param("id")) ?? [] }),
  );

  // The person's stop, which is the same operation the model's tool performs
  // and deliberately not a different one. Unknown id answers 404 rather than
  // succeeding quietly, because "I pressed stop and nothing happened" is the
  // failure this route exists to make visible.
  routes.post("/:id/jobs/:jobId/stop", (context) => {
    const stopped = options.backgroundJobs?.stop(
      context.req.param("id"),
      context.req.param("jobId"),
    );
    if (stopped !== true) {
      return context.json({ error: "There is no such background command." }, 404);
    }
    const job = options.backgroundJobs?.get(context.req.param("id"), context.req.param("jobId"));
    return context.json({ job: job ?? null });
  });

  // Whether a browser was actually running is the whole answer: "I pressed
  // stop and nothing happened" and "there was nothing to stop" look the same
  // from a button, and only one of them is a bug.
  routes.post("/:id/browser/stop", async (context) => {
    const stopped = (await options.browser?.stop(context.req.param("id"))) ?? false;
    return context.json({ stopped });
  });

  routes.post("/:id/browser/interact", async (context) => {
    context.header("Cache-Control", "no-store");
    const id = context.req.param("id");
    if (store.get(id) === undefined) return context.json({ error: { code: "not_found", message: "Conversation not found." } }, 404);
    const parsed = v.safeParse(browserInteractionSchema, await body(context));
    if (!parsed.success) throw invalidBody("The browser interaction is invalid.");
    if (options.browser?.interact === undefined) return context.json({ error: { message: "Live browser control is unavailable." } }, 503);
    return context.json(await options.browser.interact(id, parsed.output));
  });

  routes.post("/:id/computer/stop", async (context) => {
    const stopped = (await options.computer?.stop(context.req.param("id"))) ?? false;
    return context.json({ stopped });
  });

  routes.post("/", async (context) => {
    try {
      const input = parseBody(conversationCreateSchema, await body(context));
      return context.json(store.record(input), 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // A true fork of one conversation under a caller-chosen id: its index row,
  // its transcript, its scoped rows and its tree, duplicated server-side as
  // one id. The id arrives minted because ids are caller-chosen (ADR 0045)
  // and one fork is one id everywhere - the row, the copies and the reads
  // that follow. An optional submission id turns the fork into a branch cut
  // after that submission's last batch. Unknown source answers 404; an id
  // that exists, a turn in flight or a running task answers 409 with the
  // reason, and nothing is duplicated at all in those cases.
  routes.post("/:id/fork", async (context) => {
    try {
      const parsed = parseBody(forkBodySchema, await body(context));
      const outcome = forkConversation(
        {
          conversations: store,
          grants,
          selection,
          plans,
          folders,
          documents,
          tasks,
          ...(options.contextUsage === undefined
            ? {}
            : { usage: options.contextUsage }),
          flueJournalPath: resolveFlueJournalPath(),
        },
        context.req.param("id"),
        parsed.id,
        parsed.upToSubmissionId === undefined
          ? {}
          : { upToSubmissionId: parsed.upToSubmissionId },
      );
      return context.json(outcome.conversation, 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // The documents a person attaches. The bytes travel as base64 in JSON,
  // the one body shape the webview's transport carries (a request goes
  // through Rust as a string, `STUDIO/src/platform/harness/transport.ts`),
  // the same way the library takes a file. A third again on the wire for a
  // fifty-megabyte file is the cost, named in the plan's parked storage
  // work. The upload reads the document once and answers what the model
  // will be told; the announcement itself waits for the next user message.
  // A document taken back before that is deleted here with its file.
  routes.get("/:id/documents", (context) => {
    try {
      return context.json({ documents: documents.list(context.req.param("id")).map(publicDocument) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/:id/documents", async (context) => {
    try {
      const parsed = parseBody(documentUploadSchema, await body(context));
      const document = await documents.add(context.req.param("id"), {
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        bytes: new Uint8Array(decodedBase64(parsed.data)),
      });
      return context.json({ document: publicDocument(document) }, 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.delete("/:id/documents/:documentId", (context) => {
    try {
      const removed = documents.remove(context.req.param("id"), context.req.param("documentId"));
      if (!removed) {
        throw new StorageError("not_found", { message: "There is no such document." });
      }
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.patch("/:id", async (context) => {
    try {
      const parsed = parseBody(conversationPatchSchema, await body(context));
      return context.json(store.patch(context.req.param("id"), parsed));
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // The trees a previous partial delete left behind: no index row addresses
  // them, so the purge cannot target them and this listing is what reaches
  // them instead. Read-only; the sweep below is the part that deletes.
  routes.get("/orphan-trees", async (context) => {
    try {
      return context.json(
        await listOrphanConversationTrees(store, resolveFlueJournalPath()),
      );
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Removes the orphaned trees, one by one, at a person's request. Never run
  // on a timer and never as part of another call: nothing in Studio deletes
  // on its own.
  routes.post("/orphan-trees/sweep", async (context) => {
    try {
      return context.json(
        await sweepOrphanConversationTrees(store, resolveFlueJournalPath()),
      );
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Permanent destruction of one conversation: its journal rows, its scoped
  // rows, its index row, and its own tree - see `conversations/purge.ts` for
  // the order and what each step owns. A conversation with a turn in flight
  // is refused with 409 rather than reported inside a 200: the delete did
  // not happen at all, and an outcome shaped like a partial success would
  // say otherwise.
  routes.delete("/:id", async (context) => {
    try {
      const id = context.req.param("id");
      const outcome = await purgeConversations(
        {
          conversations: store,
          grants,
          selection,
          plans,
          questions,
          folders,
          documents,
          tasks,
          flueJournalPath: resolveFlueJournalPath(),
        },
        [id],
      );
      if (outcome.removed.includes(id)) options.contextUsage?.forget?.(id);
      const detail = outcome.details[id];
      if (!outcome.removed.includes(id) && detail?.errorCode === "storage.conflict") {
        throw new StorageError("conflict", {
          message: detail.error ?? `Conversation "${id}" cannot be deleted right now.`,
        });
      }
      return context.json(outcome);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Permanent destruction over a selection - or all of the archive at once.
  // Always answers 200 with the per-id outcome: over many ids a refusal for
  // one running conversation must not fail the others, so each id reports
  // what was destroyed and what was not.
  routes.post("/purge", async (context) => {
    try {
      const outcome = await purgeConversations(
        {
          conversations: store,
          grants,
          selection,
          plans,
          questions,
          folders,
          documents,
          tasks,
          flueJournalPath: resolveFlueJournalPath(),
        },
        idsForPurge(await body(context)),
      );
      for (const id of outcome.removed) options.contextUsage?.forget?.(id);
      return context.json(outcome);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}

/**
 * A document as the webview sees it: what the chip shows and what the
 * composer needs to take it back. The path stays on the harness side - the
 * model reads it, the person is shown the name - and the inlined text is
 * the model's, not something to ship to the screen twice.
 */
function publicDocument(document: ConversationDocument): PublicDocument {
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    byteLength: document.byteLength,
    pageCount: document.pageCount,
    unit: document.unit,
    emptyPages: document.emptyPages,
    announced: document.announcedAt !== null,
  };
}

export interface PublicDocument {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly unit: "page" | "slide" | "sheet";
  readonly emptyPages: readonly number[];
  readonly announced: boolean;
}
