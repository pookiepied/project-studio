import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createStudioUuid } from "../../src/contracts/uuid.js";
import { CLIENT_ATTRIBUTE_KEYS, CLIENT_OBSERVATION_NAMES } from "../../src/contracts/source-observations.js";
import { DiagnosticRecorder } from "../../src/observability/recorder.js";
import { createObservationRoutes } from "../../src/transport/http/routes/observations.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";

function fixture() {
  const recorder = new DiagnosticRecorder();
  recorder.configure({ enabled: true });
  const session = createAdmissionSession({ clientId: "paired-host", clientType: "studio-host" });
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route("/api/observations", createObservationRoutes(recorder));
  const event = {
    v: 1, eventId: createStudioUuid(), bootId: createStudioUuid(), sequence: 1,
    timestamp: "2026-10-16T00:00:00.000Z", monotonicMs: 123,
    name: "client.display", phase: "progress", identity: { conversationId: "cnv_test", messageId: "message" },
    attributes: { stage: "first_dom_commit", characters: 5 },
  };
  const send = (events: unknown[], captureId: string = recorder.captureId) => app.request("/api/observations", {
    method: "POST", headers: { authorization: `Bearer ${session.credential}`, "content-type": "application/json" },
    body: JSON.stringify({ captureId, dropped: 0, events }),
  });
  return { recorder, app, event, send, session };
}

describe("cross-process operational observation port", () => {
  it("keeps every native command in the fixed observation policy or diagnostic self-exclusion", () => {
    const native = readFileSync("../STUDIO/src-tauri/src/lib.rs", "utf8");
    const diagnostics = readFileSync("../STUDIO/src-tauri/src/diagnostics.rs", "utf8");
    const handlers = /tauri::generate_handler!\[([\s\S]*?)\]/.exec(native)?.[1];
    expect(handlers).toBeDefined();
    for (const entry of handlers?.split(",") ?? []) {
      const command = entry.trim().split("::").at(-1);
      if (!command) continue;
      expect(diagnostics, command).toContain(`"${command}"`);
    }
    expect(native).toContain("diagnostics::command_received(invoke.message.command())");
  });
  it("preserves source identity and clocks and deduplicates repeated delivery", async () => {
    const { recorder, event, send } = fixture();
    expect((await send([event])).status).toBe(200);
    await send([event]);
    const events = recorder.read().events;
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toMatchObject({ kind: "client", eventId: event.eventId, bootId: event.bootId, sequence: 1,
      clientId: "paired-host", monotonicMs: 123 });
    expect(events[0]?.bootId).toBe(recorder.bootId);
    expect(events[0]?.timestamp).not.toBe(event.timestamp);
    expect(events[0]?.identity.conversationId).toBe("cnv_test");
  });

  it("does not resurrect cleared evidence or accept bodies through operational ingest", async () => {
    const { recorder, event, send } = fixture();
    const oldCapture = recorder.captureId;
    recorder.clear();
    expect(await (await send([event], oldCapture)).json()).toEqual({ accepted: 0, stale: true });
    expect((await send([{ ...event, content: "not permitted" }])).status).toBe(400);
    expect((await send([{ ...event, attributes: { prompt: "not permitted" } }])).status).toBe(400);
    expect((await send([{ ...event, timestamp: "a-secret-in-a-clock-field" }])).status).toBe(400);
    expect(recorder.read().events).toEqual([]);
  });

  it("keeps proxy-verified paired provenance separate from the host admission", async () => {
    const { app, recorder, event, session } = fixture();
    const response = await app.request("/api/observations", { method: "POST",
      headers: { authorization: `Bearer ${session.credential}`, "X-Project-Studio-Device-Id": "pd_verified" },
      body: JSON.stringify({ captureId: recorder.captureId, dropped: 0, events: [event] }) });
    expect(response.status).toBe(200);
    expect(recorder.read().events[0]?.source).toMatchObject({ clientId: "paired-host", deviceId: "pd_verified" });
  });

  it("requires admission and exposes no conversation scopes in its policy", async () => {
    const { app, session, recorder } = fixture();
    recorder.configure({ captureContent: true, conversations: ["private-conversation"] });
    expect((await app.request("/api/observations/policy")).status).toBe(401);
    const policy = await app.request("/api/observations/policy", { headers: { authorization: `Bearer ${session.credential}` } });
    expect(await policy.json()).toEqual({ enabled: true, captureId: recorder.captureId });
  });

  it("keeps client source names and operational fields aligned with the receiving schema", () => {
    const path = new URL("../../../STUDIO/src/platform/diagnostics/events.ts", import.meta.url);
    const source = ts.createSourceFile("events.ts", readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const arrays = new Map<string, string[]>();
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (ts.isArrayLiteralExpression(initializer)) arrays.set(node.name.text,
          initializer.elements.flatMap((element) => ts.isStringLiteral(element) ? [element.text] : []));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(arrays.get("CLIENT_OBSERVATION_NAMES")).toEqual([...CLIENT_OBSERVATION_NAMES]);
    expect(arrays.get("CLIENT_ATTRIBUTE_KEYS")).toEqual([...CLIENT_ATTRIBUTE_KEYS]);
  });

  it("ingests native clocks and request joins once and refuses stale capture or content", async () => {
    const { app, recorder, session } = fixture();
    const requestId = createStudioUuid();
    const event = { v: 1, eventId: createStudioUuid(), bootId: createStudioUuid(), sequence: 1,
      unixMs: 1_792_108_800_000, monotonicMs: 123, name: "native.stream", phase: "end", outcome: "cancelled",
      operationId: createStudioUuid(), requestId, streamId: "reader", stage: "settled", status: null, durationMs: 5, errorCode: null };
    const send = (events: unknown[], captureId = recorder.captureId, credential = session.credential) => app.request("/api/observations/native", {
      method: "POST", headers: { authorization: `Bearer ${credential}` }, body: JSON.stringify({ captureId, dropped: 2, evicted: 3, events }) });
    expect((await send([event])).status).toBe(200);
    await send([event]);
    expect(recorder.read().events).toHaveLength(1);
    expect(recorder.read().events[0]).toMatchObject({ identity: { requestId, streamId: "reader" }, outcome: "cancelled",
      attributes: { sourceDropped: 2, sourceEvicted: 3 }, source: { kind: "native", bootId: event.bootId, monotonicMs: 123 } });
    const command = { ...event, eventId: createStudioUuid(), sequence: 2, name: "native.command", phase: "progress",
      outcome: null, requestId: null, streamId: null, stage: "open_external_url", status: null, durationMs: null };
    expect(await (await send([command])).json()).toEqual({ accepted: 1 });
    expect(recorder.read().events[1]).toMatchObject({ name: "native.command", phase: "progress", attributes: { stage: "open_external_url" } });
    expect(recorder.read().events[1]?.outcome).toBeUndefined();
    expect((await send([{ ...event, content: "not native metadata" }])).status).toBe(400);
    const old = recorder.captureId;
    recorder.clear();
    expect(await (await send([event], old)).json()).toEqual({ accepted: 0, stale: true });
    const restricted = createAdmissionSession({ scopes: [ADMISSION_SCOPES.AGENT_RUN] });
    // A separate verifier-backed route proves agent scope alone is insufficient.
    const restrictedApp = new Hono<AdmissionEnv>();
    restrictedApp.use("*", createAdmissionMiddleware(restricted.verifier));
    restrictedApp.route("/api/observations", createObservationRoutes(recorder));
    expect((await restrictedApp.request("/api/observations/native/", { method: "POST",
      headers: { authorization: `Bearer ${restricted.credential}` }, body: "{}" })).status).toBe(403);
  });
});
