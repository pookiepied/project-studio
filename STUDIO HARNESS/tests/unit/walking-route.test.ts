import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";
import { WalkingRoutes } from "../../src/gateway/maps/walking.js";
import type { HttpRequestOptions } from "../../src/net/http.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { openDatabase } from "../../src/storage/database.js";
import { CallGate } from "../../src/tools/gate.js";
import { createWalkingRouteTool } from "../../src/tools/maps/walking-route.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createRoutingSettingsRoutes } from "../../src/transport/http/routes/routing-settings.js";

const stops = [
  { name: "Ramna Park", lat: 23.7375, lng: 90.3998 },
  { name: "Garden", lat: 23.7281, lng: 90.4042 },
  { name: "Ahsan Manzil", lat: 23.7086, lng: 90.4064 },
];
const coordinates = [[90.3998, 23.7375], [90.403, 23.735], [90.4042, 23.7281], [90.4064, 23.7086]];
const segments = [{ distance: 1200, duration: 840 }, { distance: 2300, duration: 1600 }];
const key = "test-secret-should-never-be-captured";
const response = (legs = segments) => JSON.stringify({
  features: [{
    geometry: { type: "LineString", coordinates },
    properties: { summary: { distance: 3500, duration: 2440 }, segments: legs },
  }],
  metadata: { secretEcho: key },
});

afterEach(() => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("walking routes", () => {
  it("sends ordered coordinates once through the gate and keeps geometry in the structured tool result", async () => {
    const request = vi.fn(async ({ url }: HttpRequestOptions) => ({ status: 200, body: response(), headers: {}, url }));
    const routes = new WalkingRoutes(new InMemoryCredentialStore(), request);
    await routes.setKey(key);
    const db = openDatabase({ path: ":memory:" });
    const gateFor = (approver?: { request: () => Promise<{ verdict: "allow"; duration: "once" }> }) => {
      const gate = new CallGate({
        kernel: new PermissionKernel({ grants: new PermissionGrantStore(db), ...(approver === undefined ? {} : { approver }) }),
        sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd(), allowNetwork: true })),
      });
      gate.register(createWalkingRouteTool(routes));
      return gate;
    };
    const call = {
      name: "native/walking_route",
      scope: { conversationId: "cnv_walk", agentId: "studio", projectId: "proj_walk" },
      input: { stops },
    };
    try {
      await expect(gateFor().call(call)).rejects.toThrow(/approved/i);
      expect(request).not.toHaveBeenCalled();
      const root = createRootExecutionContext();
      diagnosticRecorder.configure({ enabled: true });
      const gate = gateFor({ request: async () => ({ verdict: "allow", duration: "once" }) });
      const result = await runWithExecutionContext(root, () => gate.call(call));
      expect(result).toMatchObject({
        output: { kind: "walking-route", version: 1, stops, coordinates, distanceMeters: 3500,
          legs: [{ distanceMeters: 1200, durationSeconds: 840 }, { distanceMeters: 2300, durationSeconds: 1600 }] },
        content: [{ type: "text", text: expect.stringContaining("3500 metres") }],
      });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        method: "POST", url: "https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson",
        maxRedirects: 0, headers: expect.objectContaining({ authorization: key }),
        body: JSON.stringify({ coordinates: stops.map(({ lng, lat }) => [lng, lat]), instructions: true }),
      }));
      const events = diagnosticRecorder.read().events;
      const fetch = events.find((event) => event.name === "map.routing.fetch" && event.phase === "end");
      expect(fetch).toMatchObject({ outcome: "completed", identity: { requestId: root.requestId }, attributes: { provider: "openrouteservice", mode: "walking" } });
      expect(JSON.stringify(events)).not.toMatch(/Ramna Park|90\.3998|test-secret/);
    } finally {
      db.close();
    }
  });

  it("surfaces missing keys and rejects incomplete provider legs without drawing a route", async () => {
    const request = vi.fn(async ({ url }: HttpRequestOptions) => ({ status: 200, body: response(segments.slice(0, 1)), headers: {}, url }));
    const routes = new WalkingRoutes(new InMemoryCredentialStore(), request);
    await expect(routes.route(stops, undefined)).rejects.toMatchObject({ kind: "routing_not_configured" });
    expect(request).not.toHaveBeenCalled();
    await routes.setKey(key);
    await expect(routes.route(stops, undefined)).rejects.toMatchObject({ kind: "routing_invalid_response" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps the key out of settings responses and requires provider-management scope", async () => {
    const routes = new WalkingRoutes(new InMemoryCredentialStore());
    function appFor(session = createAdmissionSession()) {
      const app = new Hono<AdmissionEnv>();
      app.use("*", createAdmissionMiddleware(session.verifier));
      app.route("/api/providers/routing", createRoutingSettingsRoutes(routes));
      return (method: string, suffix = "", body?: string) => app.request(`/api/providers/routing${suffix}`, {
        method, ...(body === undefined ? {} : { body }), headers: { authorization: `Bearer ${session.credential}` },
      });
    }
    const restricted = appFor(createAdmissionSession({ clientType: "studio-client" }));
    expect((await restricted("PUT", "/key", JSON.stringify({ apiKey: key }))).status).toBe(403);
    expect(await routes.hasKey()).toBe(false);
    const owner = appFor();
    expect((await owner("PUT", "/key", JSON.stringify({ apiKey: key }))).status).toBe(204);
    expect(await (await owner("GET")).json()).toEqual({ configured: true });
    expect((await owner("DELETE", "/key")).status).toBe(204);
    expect(await (await owner("GET")).json()).toEqual({ configured: false });
  });
});
