import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { RetrievalAdministration } from "../../src/application/retrieval-management.js";
import type { SkillAdministration } from "../../src/application/skill-management.js";
import type { ExecutionScope } from "../../src/contracts/capabilities.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import type { ProviderAdministration } from "../../src/gateway/connections/management.js";
import type { MediaAdministration } from "../../src/gateway/media/service.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import type { ProjectStore } from "../../src/projects/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The grants routes are the delivery path for a promise the grant store's
 * header has made since it was written: the person can see what they have
 * approved and take it back. The store-level behaviour — a revocation stops
 * authorizing, revoked rows survive — is proven in `permissions.test.ts`;
 * what this suite adds is the HTTP surface: admission, the scope guard, the
 * filters the query string carries. The store behind the routes is real,
 * because a route tested against a double would prove nothing about the
 * rows it serves.
 */

function probeAgent(): string {
  return "grants probe";
}
probeAgent.agentName = "grants-probe";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

let db: StudioDatabase;
let grants: PermissionGrantStore;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  grants = new PermissionGrantStore(db);
});

afterEach(() => {
  db.close();
});

/** The app under test: every other surface a double, the grant store real. */
function harnessApp(session: ReturnType<typeof createAdmissionSession>) {
  return createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    skills: { list: () => [], problems: () => [] } as unknown as SkillAdministration,
    providers: { listConnections: () => [] } as unknown as ProviderAdministration,
    retrieval: {} as unknown as RetrievalAdministration,
    media: {} as unknown as MediaAdministration,
    approvals: {} as unknown as PermissionApprovalBroker,
    grants,
    conversations: { list: () => [] } as unknown as ConversationStore,
    projects: { list: () => [] } as unknown as ProjectStore,
    database: db,
    admission: session.verifier,
    // No submission in this suite carries turn settings.
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
  });
}

describe("the grants routes", () => {
  it("refuse a request without and with wrong credentials", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);

    const attempts = [
      { method: "GET", url: "http://harness.test/api/permissions/grants" },
      { method: "DELETE", url: "http://harness.test/api/permissions/grants/some-id" },
    ];
    for (const { method, url } of attempts) {
      const missing = await app.request(url, { method });
      expect(missing.status, `${method} without a credential`).toBe(401);
      const wrong = await app.request(url, {
        method,
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(wrong.status, `${method} with a wrong credential`).toBe(401);
    }
  });

  it("refuse a session that holds no approval scope", async () => {
    const session = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });
    const app = harnessApp(session);

    const response = await app.request("http://harness.test/api/permissions/grants", {
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(403);
  });

  it("lists what was approved and narrows by the filters given", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    grants.grant({ namespace: "native", name: "write_file" }, SCOPE, "always");
    grants.grant(
      { namespace: "native", name: "write_file" },
      { ...SCOPE, agentId: "researcher" },
      "always",
    );
    const authorized = { authorization: `Bearer ${session.credential}` };

    const all = await app.request("http://harness.test/api/permissions/grants", {
      headers: authorized,
    });
    expect(all.status).toBe(200);
    expect(await all.json()).toHaveLength(2);

    const narrowed = await app.request(
      "http://harness.test/api/permissions/grants?agentId=researcher",
      { headers: authorized },
    );
    const rows = (await narrowed.json()) as { agentId: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agentId).toBe("researcher");
  });

  it("makes a revocation through the route take effect on the next call", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    grants.grant({ namespace: "native", name: "write_file" }, SCOPE, "always");
    const authorized = { authorization: `Bearer ${session.credential}` };

    const listed = (await (
      await app.request("http://harness.test/api/permissions/grants", { headers: authorized })
    ).json()) as { id: string }[];
    expect(listed).toHaveLength(1);
    const id = listed[0]?.id as string;

    const revoked = await app.request(
      `http://harness.test/api/permissions/grants/${id}`,
      { method: "DELETE", headers: authorized },
    );
    expect(revoked.status).toBe(204);

    // "The next call" is the one that matters, and it is not the listing:
    // the kernel's `find()` is what gates a tool call, so a revocation that
    // only hid the row from views would be a screen, not a withdrawal. The
    // route and the kernel read one table, so the mark must be visible here.
    expect(grants.find({ namespace: "native", name: "write_file" }, SCOPE)).toBeUndefined();

    const relisted = await app.request("http://harness.test/api/permissions/grants", {
      headers: authorized,
    });
    expect(await relisted.json()).toEqual([]);

    const again = await app.request(
      `http://harness.test/api/permissions/grants/${id}`,
      { method: "DELETE", headers: authorized },
    );
    expect(again.status).toBe(404);
  });

  it("keeps a revoked row as a record", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    grants.grant({ namespace: "native", name: "write_file" }, SCOPE, "always");
    const authorized = { authorization: `Bearer ${session.credential}` };

    const listed = (await (
      await app.request("http://harness.test/api/permissions/grants", { headers: authorized })
    ).json()) as { id: string }[];
    const id = listed[0]?.id as string;
    const revoked = await app.request(
      `http://harness.test/api/permissions/grants/${id}`,
      { method: "DELETE", headers: authorized },
    );
    expect(revoked.status).toBe(204);

    // Marked, not deleted: the row must still be there with a revocation
    // time, because what was once approved is the thing that makes a
    // reinstall reviewable.
    const row = db
      .prepare("SELECT revoked_at FROM permission_grant WHERE id = ?")
      .get(id) as { revoked_at: number | null } | undefined;
    expect(row?.revoked_at).toBeTypeOf("number");
  });
});
