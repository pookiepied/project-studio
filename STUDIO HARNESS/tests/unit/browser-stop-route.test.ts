import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createConversationRoutes } from "../../src/transport/http/routes/conversations.js";

/**
 * The person's stop for a conversation's browser (ADR 0049 §4).
 *
 * The route's whole contract is one boolean, and the boolean is the
 * difference between "there was nothing to stop" and "I pressed stop and
 * nothing happened". So what is pinned is that the answer is the runtime's
 * answer, addressed to the conversation the button belongs to, and that a
 * composition with no runtime says false rather than failing.
 */

let db: StudioDatabase;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
});

afterEach(() => {
  db.close();
});

type Stopper = { stop(conversationId: string): Promise<boolean> };

function build(browser?: Stopper, computer?: Stopper) {
  const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route(
    "/api/conversations",
    createConversationRoutes({
      conversations: { list: () => [] } as unknown as ConversationStore,
      database: db,
      ...(browser === undefined ? {} : { browser }),
      ...(computer === undefined ? {} : { computer }),
    }),
  );
  return { app, authorization: `Bearer ${session.credential}` };
}

describe("stopping a conversation's browser", () => {
  it("asks the runtime about that conversation and answers what it said", async () => {
    const asked: string[] = [];
    const { app, authorization } = build({
      stop: (conversationId) => {
        asked.push(conversationId);
        return Promise.resolve(true);
      },
    });
    const response = await app.request("http://harness.test/api/conversations/cnv_7/browser/stop", {
      method: "POST",
      headers: { authorization },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: true });
    expect(asked).toEqual(["cnv_7"]);
  });

  it("says nothing was running when there is no runtime to ask", async () => {
    const { app, authorization } = build();
    const response = await app.request("http://harness.test/api/conversations/cnv_7/browser/stop", {
      method: "POST",
      headers: { authorization },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: false });
  });
});

/**
 * The computer's stop (ADR 0055 §7) is the same contract at its own path:
 * the pill on screen presses it, and the pill must be told the truth about
 * whether anything was driving.
 */
describe("stopping a conversation's computer control", () => {
  it("asks the runtime about that conversation and answers what it said", async () => {
    const asked: string[] = [];
    const { app, authorization } = build(undefined, {
      stop: (conversationId) => {
        asked.push(conversationId);
        return Promise.resolve(true);
      },
    });
    const response = await app.request("http://harness.test/api/conversations/cnv_9/computer/stop", {
      method: "POST",
      headers: { authorization },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: true });
    expect(asked).toEqual(["cnv_9"]);
  });

  it("says nothing was running when there is no runtime to ask", async () => {
    const { app, authorization } = build();
    const response = await app.request("http://harness.test/api/conversations/cnv_9/computer/stop", {
      method: "POST",
      headers: { authorization },
    });
    expect(await response.json()).toEqual({ stopped: false });
  });
});
