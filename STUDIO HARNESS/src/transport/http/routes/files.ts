import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { locateConversationFile, readConversationText } from "../../../conversations/files.js";
import { observeOperation } from "../../../observability/operation.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

const CONVERSATION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Files a reply mentions, for the window that shows the reply.
 *
 * Nothing found is a 200 with `null`, not a 404: it is an answer about the file,
 * and the client has to be able to tell it from the harness not answering. Only
 * a malformed request is an error. Both reads are operations of their own because
 * a lookup can walk a folder tree. Their observations carry no path: what a
 * person clicked is content, and these are facts about the read.
 */
export function createFileRoutes(options: {
  /** The folders of the project a conversation is filed under, first where it stands. */
  readonly projectFolders: (conversationId: string) => readonly string[];
}): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));

  routes.get("/:conversationId/locate", async (context) => {
    const conversationId = context.req.param("conversationId");
    const path = context.req.query("path");
    if (!CONVERSATION_ID.test(conversationId) || path === undefined || path === "") {
      return context.json({ error: "A conversation and a path are required.", code: "files.bad-request" }, 400);
    }
    const location = await observeOperation(
      "request",
      "files.locate",
      () => locateConversationFile(conversationId, path, options.projectFolders(conversationId)),
      {},
      conversationId,
    ).catch(() => null);
    return context.json({ location });
  });

  routes.get("/:conversationId/text", async (context) => {
    const conversationId = context.req.param("conversationId");
    const path = context.req.query("path");
    if (!CONVERSATION_ID.test(conversationId) || path === undefined || path === "") {
      return context.json({ error: "A conversation and a path are required.", code: "files.bad-request" }, 400);
    }
    const file = await observeOperation(
      "request",
      "files.read_text",
      () => readConversationText(conversationId, path, options.projectFolders(conversationId)),
      {},
      conversationId,
    ).catch(() => null);
    // The file may change between reads, so the window is told not to keep it.
    context.header("cache-control", "private, no-cache");
    return context.json({ file });
  });

  return routes;
}
