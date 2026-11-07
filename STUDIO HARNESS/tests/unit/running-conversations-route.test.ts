import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createConversationRoutes } from "../../src/transport/http/routes/conversations.js";

/**
 * Which conversations have a turn in flight. What counts as in flight is pinned
 * beside the journal reader; here it is the route's own shape and its admission.
 */

const URL = "http://harness.test/api/conversations/running";

let db: StudioDatabase;
let workspace: string;
let priorPath: string | undefined;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-running-"));
  priorPath = process.env.PROJECT_STUDIO_DB_PATH;
  process.env.PROJECT_STUDIO_DB_PATH = join(workspace, "absent.db");
});

afterEach(() => {
  db.close();
  if (priorPath === undefined) delete process.env.PROJECT_STUDIO_DB_PATH;
  else process.env.PROJECT_STUDIO_DB_PATH = priorPath;
  rmSync(workspace, { recursive: true, force: true });
});

function build() {
  const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route(
    "/api/conversations",
    createConversationRoutes({
      conversations: { list: () => [] } as unknown as ConversationStore,
      database: db,
    }),
  );
  return { app, authorization: `Bearer ${session.credential}` };
}

describe("the running conversations route", () => {
  it("answers an empty list when no journal exists yet", async () => {
    const { app, authorization } = build();
    const response = await app.request(URL, { headers: { authorization } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationIds: [] });
  });

  it("refuses a caller with no credential", async () => {
    const { app } = build();
    const response = await app.request(URL);

    expect(response.status).toBe(401);
  });
});
