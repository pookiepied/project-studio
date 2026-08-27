import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import {
  conversationCreateSchema,
  conversationPatchSchema,
} from "../../../contracts/conversations.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { purgeConversations } from "../../../conversations/purge.js";
import type { ConversationStore } from "../../../conversations/store.js";
import { failure, invalidBody, statusOf } from "./error-status.js";

export interface ConversationRoutesOptions {
  /** The index of conversations that exist, and the one owner of its rows. */
  readonly conversations: ConversationStore;
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

  // Permanent destruction of one conversation. It removes the index row and
  // the conversation's own tree; what it cannot remove, and why, is written
  // in `conversations/purge.ts` rather than claimed here.
  routes.delete("/:id", async (context) => {
    try {
      return context.json(await purgeConversations(store, [context.req.param("id")]));
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Permanent destruction over a selection — or all of the archive at once.
  routes.post("/purge", async (context) => {
    try {
      const outcome = await purgeConversations(store, idsForPurge(await body(context)));
      return context.json(outcome);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}
