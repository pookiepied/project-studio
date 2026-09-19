import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { SkillAdministration } from "../../src/application/skill-management.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ProjectStore } from "../../src/projects/store.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { ProviderManagementService } from "../../src/gateway/connections/management.js";
import { RetrievalManagementService } from "../../src/application/retrieval-management.js";
import { RetrievalSettingsStore } from "../../src/gateway/retrieval/settings.js";
import {
  listInterpreters,
  preferInterpreter,
  resolveInterpreter,
  type InterpreterKind,
} from "../../src/process/interpreter.js";
import { ShellSettingsStore } from "../../src/process/shell-settings.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The shell the person picks (ADR 0057).
 *
 * The route reports three things a settings page needs and must not
 * conflate: what this machine has, what is running lines, and what was
 * asked for. The last two differ exactly when the preference names a shell
 * the machine lacks, which is a state the page has to be able to show
 * rather than one the store quietly repairs.
 */

function probeAgent(): string {
  return "shell route probe";
}
probeAgent.agentName = "shell-route-probe";

let db: StudioDatabase;
let app: ReturnType<typeof createHttpApp>;
let session: ReturnType<typeof createAdmissionSession>;

interface ShellBody {
  readonly preferred: InterpreterKind | null;
  readonly active: { readonly kind: InterpreterKind; readonly path: string } | null;
  readonly available: readonly { readonly kind: InterpreterKind; readonly label: string; readonly path: string }[];
}

function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(`http://harness.test${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${session.credential}`,
        "content-type": "application/json",
      },
    }),
  );
}

async function read(): Promise<ShellBody> {
  const response = await authorized("/api/sandbox/shell");
  expect(response.status).toBe(200);
  return (await response.json()) as ShellBody;
}

async function choose(interpreter: InterpreterKind | null): Promise<Response> {
  return authorized("/api/sandbox/shell", {
    method: "PUT",
    body: JSON.stringify({ interpreter }),
  });
}

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  const credentials = new InMemoryCredentialStore();
  const connections = new ConnectionStore({ db, credentials });
  session = createAdmissionSession();
  app = createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    skills: { list: () => [], problems: () => [] } as unknown as SkillAdministration,
    providers: new ProviderManagementService({
      connections,
      catalog: new ModelCatalog({ db, connections }),
    }),
    retrieval: new RetrievalManagementService({
      settings: new RetrievalSettingsStore(db),
      credentials,
    }),
    media: {
      transcribe: () => Promise.resolve({ text: "" }),
      speak: () => Promise.resolve({ audio: "", mimeType: "audio/mpeg" }),
    },
    approvals: { list: () => [] } as unknown as PermissionApprovalBroker,
    conversations: new ConversationStore(db),
    projects: new ProjectStore(db),
    scopes: new SandboxScopeStore(db),
    shell: new ShellSettingsStore(db),
    database: db,
    admission: session.verifier,
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
  });
});

afterEach(() => {
  // The preference is process state shared with every other test; nothing
  // here may leave one behind.
  preferInterpreter(undefined);
  db.close();
});

describe("the shell route", () => {
  it("reports what the machine has, and that nothing is preferred until something is", async () => {
    const body = await read();
    expect(body.preferred).toBeNull();
    expect(body.available.map((entry) => entry.kind)).toEqual(
      listInterpreters().map((entry) => entry.kind),
    );
    expect(body.active?.path).toBe(resolveInterpreter()?.path);
  });

  it("stores the choice, applies it to the running process, and reads it back", async () => {
    const available = listInterpreters();
    const last = available[available.length - 1];
    if (last === undefined) return;

    const response = await choose(last.kind);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ShellBody;
    expect(body.preferred).toBe(last.kind);
    expect(body.active?.kind).toBe(last.kind);
    // The process, not only the row: the shell tool asks this function.
    expect(resolveInterpreter()).toBe(last);
    // And the row, not only the process: a fresh store over the same
    // database is what the next start reads.
    expect(new ShellSettingsStore(db).read()).toBe(last.kind);

    await choose(null);
    expect((await read()).preferred).toBeNull();
    expect(resolveInterpreter()).toBe(available[0]);
  });

  it("keeps a preference this machine cannot honour, and says what runs instead", async () => {
    const available = listInterpreters();
    const missing = (["pwsh", "bash", "powershell", "cmd", "sh"] as const).find(
      (kind) => !available.some((entry) => entry.kind === kind),
    );
    if (missing === undefined) return;

    await choose(missing);
    const body = await read();
    expect(body.preferred).toBe(missing);
    expect(body.active?.kind).toBe(available[0]?.kind);
  });

  it("refuses a kind it does not know", async () => {
    const response = await authorized("/api/sandbox/shell", {
      method: "PUT",
      body: JSON.stringify({ interpreter: "fish" }),
    });
    expect(response.status).toBe(400);
  });
});
