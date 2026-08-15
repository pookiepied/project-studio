import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { StudioRuntime } from "../../src/application/studio-runtime.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";
import {
  authContext,
  createAdmissionMiddleware,
  executionContext,
  requireAdmissionScope,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";

describe("Harness HTTP admission", () => {
  it("stops a route before its handler for missing and wrong credentials", async () => {
    const session = createAdmissionSession();
    const app = new Hono<AdmissionEnv>();
    let entered = 0;
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.get("/probe", (context) => {
      entered += 1;
      return context.json({ clientId: authContext(context).clientId });
    });

    const missing = await app.request("http://harness.test/probe");
    const wrong = await app.request("http://harness.test/probe", {
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(entered).toBe(0);
  });

  it("stores AuthContext and separates scope authorization", async () => {
    const session = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });
    const app = new Hono<AdmissionEnv>();
    let entered = 0;
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.use("/managed", requireAdmissionScope(ADMISSION_SCOPES.EXTENSION_MANAGEMENT));
    app.get("/managed", (context) => {
      entered += 1;
      return context.json({ clientId: authContext(context).clientId });
    });

    const response = await app.request("http://harness.test/managed", {
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(403);
    expect(entered).toBe(0);
  });

  it("creates one request execution context after admission", async () => {
    const session = createAdmissionSession({ clientId: "desktop", sessionId: "session-1" });
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.get("/probe", (context) => {
      const execution = executionContext(context);
      return context.json({
        requestId: execution.requestId,
        clientId: execution.clientId,
        sessionId: execution.sessionId,
      });
    });
    const requestId = "6f5e6e6c-3a3a-4b12-9c55-1d253ce34db0";

    const response = await app.request("http://harness.test/probe", {
      headers: {
        authorization: `Bearer ${session.credential}`,
        "X-Project-Studio-Request-Id": requestId,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestId,
      clientId: "desktop",
      sessionId: "session-1",
    });
  });

  it("places one admission boundary before Flue, MCP, and permission routes", async () => {
    const session = createAdmissionSession();
    const flueApp = new Hono();
    let flueEntered = 0;
    let mcpEntered = 0;
    let permissionEntered = 0;
    flueApp.get("/probe", () => {
      flueEntered += 1;
      return new Response("entered");
    });

    const app = createHttpApp({
      runtime: {
        registry: {
          list: () => {
            mcpEntered += 1;
            return [];
          },
        },
      } as unknown as StudioRuntime,
      approvals: {
        list: () => {
          permissionEntered += 1;
          return [];
        },
      } as unknown as PermissionApprovalBroker,
      admission: session.verifier,
      flueApp,
    });

    for (const path of ["/probe", "/api/mcp/servers", "/api/permissions/pending"]) {
      const response = await app.request(`http://harness.test${path}`);
      expect(response.status, path).toBe(401);

      const wrong = await app.request(`http://harness.test${path}`, {
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(wrong.status, path).toBe(401);
    }
    expect(flueEntered).toBe(0);
    expect(mcpEntered).toBe(0);
    expect(permissionEntered).toBe(0);

    const admittedProbe = await app.request("http://harness.test/probe", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    const admittedMcp = await app.request("http://harness.test/api/mcp/servers", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    const admittedPermissions = await app.request("http://harness.test/api/permissions/pending", {
      headers: { authorization: `Bearer ${session.credential}` },
    });
    expect(admittedProbe.status).toBe(200);
    expect(await admittedProbe.text()).toBe("entered");
    expect(admittedMcp.status).toBe(200);
    expect(admittedPermissions.status).toBe(200);
    expect(flueEntered).toBe(1);
    expect(mcpEntered).toBe(1);
    expect(permissionEntered).toBe(1);
  });
});
