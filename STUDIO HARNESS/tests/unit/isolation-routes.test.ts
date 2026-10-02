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
import { IsolationSettingsStore } from "../../src/sandbox/isolation-settings.js";
import { NO_ISOLATION } from "../../src/sandbox/isolation/backend.js";
import {
  hostIsolation,
  ISOLATION_OFFERED,
  isolationWanted,
  preferIsolation,
} from "../../src/sandbox/isolation/registry.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The sandbox fence switch (ADR 0057).
 *
 * Off until the person turns it on, stored across runs, applied to the
 * process the moment it is written, and honest about the platform: on a
 * build with no backend for this platform the page must be told there is
 * nothing to turn on, whatever the stored switch says.
 */

function probeAgent(): string {
  return "isolation route probe";
}
probeAgent.agentName = "isolation-route-probe";

let db: StudioDatabase;
let app: ReturnType<typeof createHttpApp>;
let session: ReturnType<typeof createAdmissionSession>;

interface IsolationBody {
  readonly enabled: boolean;
  readonly offered: boolean;
  readonly backend: string | null;
  readonly shortfall: readonly string[];
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

async function read(): Promise<IsolationBody> {
  const response = await authorized("/api/sandbox/isolation");
  expect(response.status).toBe(200);
  return (await response.json()) as IsolationBody;
}

async function choose(enabled: unknown): Promise<Response> {
  return authorized("/api/sandbox/isolation", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
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
    grants: { list: () => [], revoke: () => false },
    conversations: new ConversationStore(db),
    projects: new ProjectStore(db),
    scopes: new SandboxScopeStore(db),
    isolation: new IsolationSettingsStore(db),
    database: db,
    admission: session.verifier,
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
  });
});

afterEach(() => {
  // The switch is process state shared with every other test; nothing here
  // may leave it on.
  preferIsolation(false);
  db.close();
});

describe("the isolation route", () => {
  it("reports the fence off, and whether this platform offers one", async () => {
    const body = await read();
    expect(body.enabled).toBe(false);
    expect(body.offered).toBe(ISOLATION_OFFERED);
    expect(body.backend).toBeNull();
    expect(body.shortfall).toEqual([]);
    expect(hostIsolation()).toBe(NO_ISOLATION);
  });

  it("stores the switch and applies it to the process, then reads it back fresh", async () => {
    const on = await choose(true);
    expect(on.status).toBe(200);
    expect(((await on.json()) as IsolationBody).enabled).toBe(true);
    // Wanted, and in effect exactly where a backend exists to want.
    expect(isolationWanted()).toBe(ISOLATION_OFFERED);
    expect(new IsolationSettingsStore(db).read()).toBe(true);

    const off = await choose(false);
    expect(((await off.json()) as IsolationBody).enabled).toBe(false);
    expect(isolationWanted()).toBe(false);
    expect(new IsolationSettingsStore(db).read()).toBe(false);
  });

  it("measures the machine only once the fence is on", async () => {
    await choose(true);
    const body = await read();
    // A platform with nothing registered has nothing to measure; one with a
    // backend reports what the probe said, one way or the other.
    if (!ISOLATION_OFFERED) {
      expect(body.backend).toBeNull();
      expect(body.shortfall).toEqual([]);
    } else {
      expect(body.backend !== null || body.shortfall.length > 0).toBe(true);
    }
  });

  it("refuses a body that does not say true or false", async () => {
    const response = await choose("yes");
    expect(response.status).toBe(400);
    expect(new IsolationSettingsStore(db).read()).toBe(false);
  });
});
