import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import type { RetrievalAdministration } from "../../src/application/retrieval-management.js";
import type { SkillAdministration } from "../../src/application/skill-management.js";
import type { ConversationStore } from "../../src/conversations/store.js";
import type { ProviderAdministration } from "../../src/gateway/connections/management.js";
import type { MediaAdministration } from "../../src/gateway/media/service.js";
import type { ProjectStore } from "../../src/projects/store.js";
import { SnapshotStore, type ConversationSnapshots } from "../../src/snapshots/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The undo routes, against a real shadow repository.
 *
 * These run real git against a real temporary project, for the reason
 * `snapshots.test.ts` gives: the behaviour worth proving — that a restore
 * returns file contents, removes what came after, keeps an undo point — is
 * git's, mediated by us. What this file adds is the delivery path (register
 * #86): admission, the unknown-conversation and unknown-snapshot answers,
 * and the restore doing through HTTP what the store does in process.
 */

function probeAgent(): string {
  return "snapshots probe";
}
probeAgent.agentName = "snapshots-probe";

let workspace: string;
let snapshotRoot: string;
let db: StudioDatabase;
let store: SnapshotStore;

function write(relativePath: string, content: string): void {
  const target = join(workspace, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-snap-routes-project-"));
  snapshotRoot = mkdtempSync(join(tmpdir(), "studio-snap-routes-store-"));
  db = openDatabase({ path: ":memory:" });
  store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(snapshotRoot, { recursive: true, force: true });
});

/**
 * The port as production composes it, narrowed to one conversation because
 * the suite's project belongs to one: the id travels through and the store
 * does the work, which is exactly the division the runtime's accessor draws.
 */
const snapshots: ConversationSnapshots = {
  list: (_conversationId, limit) => store.list(limit),
  restore: (_conversationId, snapshotId) => store.restore(snapshotId),
};

function harnessApp(session: ReturnType<typeof createAdmissionSession>) {
  return createHttpApp({
    servers: { list: () => [] } as unknown as McpAdministration,
    skills: { list: () => [], problems: () => [] } as unknown as SkillAdministration,
    providers: { listConnections: () => [] } as unknown as ProviderAdministration,
    retrieval: {} as unknown as RetrievalAdministration,
    media: {} as unknown as MediaAdministration,
    approvals: {} as unknown as PermissionApprovalBroker,
    grants: { list: () => [], revoke: () => false },
    // One conversation exists; the routes check it before touching the port.
    conversations: {
      list: () => [],
      get: (id: string) => (id === "cnv_1" ? { id } : undefined),
    } as unknown as ConversationStore,
    projects: { list: () => [] } as unknown as ProjectStore,
    snapshots,
    database: db,
    admission: session.verifier,
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
  });
}

describe("the snapshot routes", () => {
  it("refuse a request without and with wrong credentials", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);

    const attempts = [
      { method: "GET", url: "http://harness.test/api/conversations/cnv_1/snapshots" },
      {
        method: "POST",
        url: "http://harness.test/api/conversations/cnv_1/snapshots/abc/restore",
      },
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

  it("refuse a session that holds no project scope", async () => {
    const session = createAdmissionSession({
      clientId: "desktop",
      clientType: "studio-client",
      scopes: [ADMISSION_SCOPES.AGENT_RUN],
    });
    const app = harnessApp(session);

    const response = await app.request("http://harness.test/api/conversations/cnv_1/snapshots", {
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(403);
  });

  it("answer 404 for a conversation that does not exist", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    const authorized = { authorization: `Bearer ${session.credential}` };

    const listed = await app.request("http://harness.test/api/conversations/cnv_9/snapshots", {
      headers: authorized,
    });
    expect(listed.status).toBe(404);

    const restored = await app.request(
      "http://harness.test/api/conversations/cnv_9/snapshots/abc/restore",
      { method: "POST", headers: authorized },
    );
    expect(restored.status).toBe(404);
  });

  it("list the recorded points, newest first", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    write("a.txt", "one");
    await store.capture("turn 1");
    write("a.txt", "two");
    await store.capture("turn 2");

    const response = await app.request("http://harness.test/api/conversations/cnv_1/snapshots", {
      headers: { authorization: `Bearer ${session.credential}` },
    });

    expect(response.status).toBe(200);
    const points = (await response.json()) as { label: string }[];
    expect(points).toHaveLength(2);
    expect(points[0]?.label).toBe("turn 2");
    expect(points[1]?.label).toBe("turn 1");
  });

  it("return the project to a recorded point, and keep an undo point", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);
    const authorized = { authorization: `Bearer ${session.credential}` };
    write("a.txt", "one");
    await store.capture("turn 1");
    write("a.txt", "two");
    write("b.txt", "made after the point");
    await store.capture("turn 2");

    const listed = (await (
      await app.request("http://harness.test/api/conversations/cnv_1/snapshots", {
        headers: authorized,
      })
    ).json()) as { id: string }[];
    const target = listed[1]?.id as string;

    const restored = await app.request(
      `http://harness.test/api/conversations/cnv_1/snapshots/${target}/restore`,
      { method: "POST", headers: authorized },
    );
    expect(restored.status).toBe(200);
    const outcome = (await restored.json()) as { undo: { label: string } };
    expect(outcome.undo.label.startsWith("before restoring ")).toBe(true);

    // The worktree is the target's: the edit is gone and so is the file that
    // was created after the point.
    expect(readFileSync(join(workspace, "a.txt"), "utf8")).toBe("one");
    expect(existsSync(join(workspace, "b.txt"))).toBe(false);

    // And the undo point is in the history, newest first, so taking the
    // restore back is itself one call.
    const relisted = (await (
      await app.request("http://harness.test/api/conversations/cnv_1/snapshots", {
        headers: authorized,
      })
    ).json()) as { label: string }[];
    expect(relisted[0]?.label).toBe(outcome.undo.label);
  });

  it("answer 404 for a snapshot id the history does not hold", async () => {
    const session = createAdmissionSession();
    const app = harnessApp(session);

    const restored = await app.request(
      "http://harness.test/api/conversations/cnv_1/snapshots/does-not-exist/restore",
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.credential}` },
      },
    );

    expect(restored.status).toBe(404);
  });
});
