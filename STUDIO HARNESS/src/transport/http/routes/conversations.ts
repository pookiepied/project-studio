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
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import {
  listOrphanConversationTrees,
  purgeConversations,
  sweepOrphanConversationTrees,
} from "../../../conversations/purge.js";
import type { ConversationStore } from "../../../conversations/store.js";
import type { ConversationUsage } from "../../../conversations/context-usage.js";
import type { JobStatus } from "../../../process/background.js";
import type { StudioDatabase } from "../../../storage/database.js";
import { StorageError } from "../../../storage/errors.js";
import { resolveFlueJournalPath } from "../../../storage/flue-journal.js";
import { failure, invalidBody, statusOf } from "./error-status.js";

export interface ConversationRoutesOptions {
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
  };
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
  const grants = new PermissionGrantStore(options.database);
  const selection = new ExtensionSelectionStore(options.database);
  const plans = new PlanItemStore(options.database);
  const questions = new PendingQuestionStore(options.database);

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
    const measured = options.contextUsage?.get(context.req.param("id"));
    return context.json({ usage: measured ?? null });
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

  routes.post("/", async (context) => {
    try {
      const input = parseBody(conversationCreateSchema, await body(context));
      return context.json(store.record(input), 201);
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
