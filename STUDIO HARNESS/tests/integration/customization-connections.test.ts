import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { CUSTOMIZATION_SERVER_ID, customizationServerPath } from "../../src/extend/mcp/builtin.js";
import { managementChildEnv } from "../../src/extend/mcp/launcher.js";
import { McpServerRegistry } from "../../src/extend/mcp/registry.js";
import { ExtensionSelectionStore, GLOBAL_SCOPE } from "../../src/extend/selection.js";
import type { AuthContext as AdmissionContext } from "../../src/admission/context.js";
import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import {
  createAdmissionMiddleware,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";
import { createMcpRoutes } from "../../src/transport/http/routes/mcp.js";
import { openDatabase } from "../../src/storage/database.js";

/**
 * The customization relay, end to end: a real StudioRuntime, the real
 * management routes over a real loopback listener, and the bundled child -
 * spoken to in its own wire protocol - answering through them.
 *
 * Everything here is the production shape minus the Host: the credential
 * rides the environment the way the launcher injects it, the registration
 * goes through the same management service the settings screens use, and
 * the child is launched the way the supervisor launches it. What the test
 * proves is the chain, and the timing truths its answers promise: the
 * relay's connection tools reach the harness's own state, an installed
 * connection's secret lands in the credential store and its switch in the
 * selection store, at the scope the conversation asked for.
 *
 * Skipped, like the registrations it exercises, when the bundle is not
 * built: a test that requires an artifact the developer has not made is a
 * test that stops being run.
 */

const credentials: SecureCredentialStore = (() => {
  const stored = new Map<string, string>();
  return {
    get: async (key) => stored.get(`${key.scope}:${key.id}`) ?? null,
    set: async (key, secret) => {
      stored.set(`${key.scope}:${key.id}`, secret);
    },
    delete: async (key) => stored.delete(`${key.scope}:${key.id}`),
  };
})();

interface Pending {
  readonly resolve: (message: Record<string, unknown>) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface Probe {
  readonly ask: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly text: (message: Record<string, unknown>) => Promise<string>;
  readonly close: () => void;
}

/** One conversation's worth of the relay's wire: one question in flight at a time. */
function probe(executable: string, bundle: string, environment: Readonly<Record<string, string>>): Promise<Probe> {
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(executable, [bundle], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    const pending: Pending[] = [];
    let buffered = "";

    const settle = (line: string): void => {
      const next = pending.shift();
      if (next === undefined) return;
      clearTimeout(next.timer);
      try {
        next.resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      let boundary = buffered.indexOf("\n");
      for (; boundary !== -1; boundary = buffered.indexOf("\n")) {
        const line = buffered.slice(0, boundary).trim();
        buffered = buffered.slice(boundary + 1);
        if (line !== "") settle(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      for (const waiter of pending.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`the relay said: ${chunk.toString("utf8").trim()}`));
      }
    });
    child.once("exit", () => {
      for (const waiter of pending.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("the relay exited before answering"));
      }
    });

    const ask = (message: Record<string, unknown>): Promise<Record<string, unknown>> =>
      new Promise((resolve, reject) => {
        const asked = typeof message["method"] === "string" ? message["method"] : "the call";
        const timer = setTimeout(() => reject(new Error(`the relay never answered: ${asked}`)), 15_000);
        pending.push({ resolve, reject, timer });
        child.stdin.write(`${JSON.stringify(message)}\n`);
      });

    const boot: (first: Record<string, unknown>) => Promise<Probe> = async (handshake) => {
      await ask(handshake);
      return {
        ask,
        text: async (call) => {
          const reply = await ask(call);
          const result = reply["result"];
          if (result === undefined || result === null || typeof result !== "object") {
            throw new Error(`the relay answered without a result: ${JSON.stringify(reply)}`);
          }
          const content = (result as { readonly content?: readonly unknown[] }).content;
          const first = content === undefined ? undefined : content[0];
          return first !== undefined &&
            typeof first === "object" &&
            (first as { readonly type?: unknown })["type"] === "text"
            ? String((first as { readonly text?: unknown })["text"])
            : "";
        },
        close: () => {
          child.stdin.end();
          child.kill();
        },
      };
    };

    const handshakeTimer = setTimeout(() => {
      rejectProbe(new Error("the relay never came up"));
      child.kill();
    }, 15_000);

    const start = (): void => {
      boot({
        jsonrpc: "2.0",
        id: 0,
        method: "server/discover",
        params: { protocolVersion: "2026-07-28" },
      })
        .then((client) => {
          clearTimeout(handshakeTimer);
          resolveProbe(client);
        })
        .catch((error: unknown) => {
          clearTimeout(handshakeTimer);
          rejectProbe(error instanceof Error ? error : new Error(String(error)));
        });
    };

    child.once("spawn", start);
    if (child.pid !== undefined) start();
  });
}

const call = (id: number, name: string, args: Record<string, unknown>, conversationId: string): Record<string, unknown> => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args, _meta: { "studio/conversation": conversationId } },
});

const previousEnvironment: Record<string, string | undefined> = {};

function take(name: string): void {
  previousEnvironment[name] = process.env[name];
}

function give(name: string, value: string): void {
  take(name);
  process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    delete previousEnvironment[name];
  }
});

describe("the customization relay, against the harness it serves", () => {
  it(
    "installs, reads, switches and removes a connection, with the secret and the switch landing where they should",
    async () => {
      const bundle = customizationServerPath();
      if (bundle === undefined) return;

      const root = mkdtempSync(join(tmpdir(), "studio-customization-"));
      give("PROJECT_STUDIO_HOME", join(root, "home"));

      const database = openDatabase({ path: join(root, "studio.db") });

      const session = createAdmissionSession({
        scopes: [ADMISSION_SCOPES.EXTENSION_MANAGEMENT, ADMISSION_SCOPES.PROJECT],
      });
      const credential = String(session.credential);
      // Published before the runtime, exactly as the harness's own bootstrap
      // publishes it: the credential is what the launcher copies into the
      // relay's environment, and the relay's first launch reads it.
      give("PROJECT_STUDIO_ADMISSION_CREDENTIAL", credential);

      // The runtime constructs before the listener, so the routes it serves
      // exist; its boot's first reconcile can lose the bind race, and the
      // supervisor's own retry brings the relay in once the port is theirs -
      // which is the production behaviour, not a test concession.
      const runtime = new StudioRuntime({ database, credentials });

      const nobody: AdmissionContext = {
        clientId: "harness",
        sessionId: "harness",
        clientType: "studio-host",
        scopes: [],
      };
      const app = new Hono<AdmissionEnv>();
      app.use("*", createAdmissionMiddleware(session.verifier));
      app.route("/api/mcp", createMcpRoutes(runtime.servers));

      let closeListener: () => void = () => undefined;
      const bound = new Promise<number>((resolve) => {
        const listener = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
          closeListener = () => listener.close();
          resolve(info.port);
        });
      });
      const port = await bound;
      give("PROJECT_STUDIO_BOUND_PORT", String(port));

      // The wake: a decision at the global scope, exactly what a settings
      // screen does - the registration put the row there, this tells the
      // reconciler the desired set changed, and the relay launches.
      runtime.servers.setEnabled(GLOBAL_SCOPE, CUSTOMIZATION_SERVER_ID, true, nobody);

      let state: string | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        state = runtime.servers.get(CUSTOMIZATION_SERVER_ID)?.status?.state;
        if (state === "ready") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(state).toBe("ready");

      // The endpoint the launcher derives is the one this test published -
      // the credential, above all, because the child presenting anything
      // else would fail admission at its very first call.
      const injected = managementChildEnv(process.env);
      expect(injected.STUDIO_MANAGEMENT_CREDENTIAL).toBe(credential);
      expect(injected.STUDIO_MANAGEMENT_URL).toBe(`http://127.0.0.1:${String(port)}`);

      const relay = await probe(process.execPath, bundle, injected);

      try {
        const definitions = (await relay.ask({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        })) as { readonly result: { readonly tools: readonly { readonly name: string }[] } };
        expect(definitions.result.tools.map((tool) => tool.name).sort()).toEqual([
          "add_connection",
          "connection_status",
          "list_connections",
          "remove_connection",
          "restart_connection",
          "set_connection",
        ]);

        const listed = await relay.text(call(2, "list_connections", {}, "cnv_loop"));
        expect(listed).toContain(CUSTOMIZATION_SERVER_ID);

        const added = await relay.text(
          call(3, "add_connection", {
            id: "blender",
            title: "Blender",
            description: "Three-dee control.",
            kind: "address",
            url: "https://blender.example/mcp",
            // No auth: the secret implies bearer - the review's default case.
            secret: "s3kr3t",
          }, "cnv_loop"),
        );
        expect(added).toContain("Installed Blender as blender");

        // The record, the key and the switch, each where the layering says.
        const saved = new McpServerRegistry(database).get("blender");
        expect(saved?.transport).toBe("http");
        expect(saved?.auth).toBe("bearer");
        expect(saved?.provenance).toBe("user");
        expect(await credentials.get({ scope: "mcp", id: "blender" })).toBe("s3kr3t");
        expect(
          new ExtensionSelectionStore(database).decisionAt({
            kind: "mcp",
            extensionId: "blender",
            scope: GLOBAL_SCOPE,
          }),
        ).toBe(true);

        const told = await relay.text(call(4, "connection_status", { id: "blender" }, "cnv_loop"));
        expect(told).toContain("Blender (blender)");
        expect(told).toContain("https://blender.example/mcp, bearer authentication");

        const removed = await relay.text(call(5, "remove_connection", { id: "blender" }, "cnv_loop"));
        expect(removed).toContain("Removed blender");
        expect(new McpServerRegistry(database).get("blender")).toBeUndefined();
        expect(await credentials.get({ scope: "mcp", id: "blender" })).toBeNull();
      } finally {
        relay.close();
        // The supervisor's child goes with the runtime; the listener stops
        // answering; the probe's own child died with its stdin. Nothing here
        // outlives the test, because the next one would inherit its port.
        await new Promise<void>((resolve) => {
          void runtime.stop().then(() => resolve());
        });
        closeListener();
        database.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
