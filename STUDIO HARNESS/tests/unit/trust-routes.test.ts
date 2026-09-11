import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type {
  CapabilityDescriptor,
  ExecutionScope,
} from "../../src/contracts/capabilities.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import { posture, WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { ProjectStore } from "../../src/projects/store.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { ProviderManagementService } from "../../src/gateway/connections/management.js";
import { RetrievalManagementService } from "../../src/application/retrieval-management.js";
import { RetrievalSettingsStore } from "../../src/gateway/retrieval/settings.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The route that lets a person answer the trust question.
 *
 * Trust was a complete gate with no door: `workspace_trust` was read before
 * every policy rule and written by nothing outside a test, so a conversation
 * standing in a project folder could only ever read - in every permission
 * mode, with every scope row, forever. The behaviour under test is therefore
 * not "the route stores a row"; it is that answering over HTTP is what opens
 * the same kernel that was refusing the write.
 */

function probeAgent(): string {
  return "trust routes probe";
}
probeAgent.agentName = "trust-probe";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

const WRITE: CapabilityDescriptor = {
  id: { namespace: "native", name: "write" },
  title: "write",
  description: "write",
  effects: ["write"],
  provenance: { origin: "native", sourceId: "project-studio", author: "studio" },
  idempotent: true,
};

let db: StudioDatabase;
let folder: string;
let projects: ProjectStore;
let trust: WorkspaceTrustStore;
let app: ReturnType<typeof createHttpApp>;
let session: ReturnType<typeof createAdmissionSession>;

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

/** The kernel the runtime builds, over the same database the routes write. */
function kernelVerdict() {
  const instance = new PermissionKernel({
    grants: new PermissionGrantStore(db),
    posture: posture({ mode: () => "manual", trust }),
  });
  instance.register(WRITE);
  return instance.evaluate(WRITE.id, SCOPE, {
    resource: join(folder, "a.txt"),
    kind: "path",
    root: folder,
  });
}

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  folder = mkdtempSync(join(tmpdir(), "studio-trust-route-"));
  projects = new ProjectStore(db);
  trust = new WorkspaceTrustStore(db);
  projects.create({
    id: "proj-1",
    name: "Alpha",
    icon: "arc",
    folders: [{ name: "alpha", path: folder }],
  });

  const credentials = new InMemoryCredentialStore();
  const connections = new ConnectionStore({ db, credentials });
  session = createAdmissionSession();
  app = createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
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
    projects,
    scopes: new SandboxScopeStore(db),
    trust,
    database: db,
    admission: session.verifier,
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
  });
});

afterEach(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});

describe("the trust route", () => {
  it("reports every folder of a project, undecided until someone answers", async () => {
    const response = await authorized(`/api/sandbox/scope?projectId=proj-1`);
    const body = (await response.json()) as {
      trust: { root: string; name: string; decision: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.trust).toHaveLength(1);
    expect(body.trust[0]?.name).toBe("alpha");
    expect(body.trust[0]?.decision).toBe("undecided");
  });

  it("opens the kernel that was refusing the write", async () => {
    // The whole point, stated as the two verdicts either side of the call.
    expect(kernelVerdict().verdict).toBe("deny");

    const response = await authorized("/api/sandbox/trust", {
      method: "PUT",
      body: JSON.stringify({ root: folder, trusted: true }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ root: folder, decision: "trusted" });
    expect(kernelVerdict().verdict).not.toBe("deny");
  });

  it("records a refusal as a decision rather than as silence", async () => {
    await authorized("/api/sandbox/trust", {
      method: "PUT",
      body: JSON.stringify({ root: folder, trusted: true }),
    });
    await authorized("/api/sandbox/trust", {
      method: "PUT",
      body: JSON.stringify({ root: folder, trusted: false }),
    });

    // "Declined" and "never asked" both refuse the write, and the difference
    // is what stops the app asking again about a folder already turned down.
    expect(trust.decision(folder)).toBe("untrusted");
    expect(kernelVerdict().reason).toMatch(/marked as not trusted/i);
  });

  it("refuses a relative path, which no folder row can be", async () => {
    const response = await authorized("/api/sandbox/trust", {
      method: "PUT",
      body: JSON.stringify({ root: "some/folder", trusted: true }),
    });

    expect(response.status).toBe(400);
  });
});
