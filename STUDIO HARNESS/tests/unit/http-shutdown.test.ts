import { describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { ProviderAdministration } from "../../src/application/provider-management.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * Composes the real app the way `src/app.ts` does, minus everything the
 * admission boundary stops this route from ever reaching. The port doubles are
 * the two lines each route actually uses, in the same spirit as
 * `http-admission.test.ts`, because none of them can be entered on the paths
 * walked here: unauthenticated, wrong client type, and accepted.
 */
function composeApp(clientType: "studio-host" | "studio-client") {
  const session = createAdmissionSession({ clientType });
  let requested = 0;
  const app = createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    providers: {
      listConnections: () => [],
    } as unknown as ProviderAdministration,
    retrieval: {
      listRetrieval: () =>
        Promise.resolve({
          search: {
            capability: "search",
            providers: [],
            primary: "tavily",
            fallback: undefined,
          },
          reader: {
            capability: "reader",
            providers: [],
            primary: "jina",
            fallback: undefined,
          },
        }),
      setRetrievalKey: () => Promise.resolve(undefined),
      clearRetrievalKey: () => Promise.resolve(undefined),
      setRetrievalSlot: () => Promise.resolve(undefined),
    },
    approvals: { list: () => [] } as unknown as PermissionApprovalBroker,
    admission: session.verifier,
    // A stand-in for "the process began its drain": the real one never returns
    // before exit, and a test that called it would end the test runner.
    requestShutdown: () => {
      requested += 1;
    },
  });
  return { app, session, requested: () => requested };
}

describe("POST /api/shutdown", () => {
  it("requires admission before the route is entered", async () => {
    const { app, requested } = composeApp("studio-host");

    const missing = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
    });
    const wrong = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(requested()).toBe(0);
  });

  it("refuses a studio-client credential even though it is admitted", async () => {
    const { app, session, requested } = composeApp("studio-client");

    const response = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only the Studio host may stop the harness process.",
      code: "admission.client_type_required",
      clientType: "studio-host",
    });
    expect(requested()).toBe(0);
  });

  it("accepts the studio-host and asks exactly once", async () => {
    const { app, session, requested } = composeApp("studio-host");

    const response = await app.request("http://harness.test/api/shutdown", {
      method: "POST",
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(requested()).toBe(1);
  });
});
