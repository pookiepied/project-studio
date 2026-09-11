import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { McpAdministration } from "../../src/application/mcp-management.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { ProjectStore } from "../../src/projects/store.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { ProviderManagementService } from "../../src/gateway/connections/management.js";
import { RetrievalManagementService } from "../../src/application/retrieval-management.js";
import { RetrievalSettingsStore } from "../../src/gateway/retrieval/settings.js";
import { browseFolders } from "../../src/sandbox/browse.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { normalizeScopePath } from "../../src/sandbox/scope.js";
import { openDatabase } from "../../src/storage/database.js";
import { createHttpApp } from "../../src/transport/http/create-app.js";

/**
 * The route that lets a browser tab walk the PC's folders.
 *
 * A folder is chosen on the machine it lives on. The desktop app opens the
 * operating system's own dialog; a paired tab has no such dialog, because the
 * file system being chosen is the PC's, not the phone's (ADR 0050, step 6).
 * What is under test is therefore the shape of the walk: directories only,
 * names sorted as a person scans them, a parent to go back out by - and
 * reading being wider than choosing, so a volume root stays a position the
 * walk can pass through while the wall stays at the folder write.
 */

function probeAgent(): string {
  return "folder browse probe";
}
probeAgent.agentName = "folder-browse-probe";

let folder: string;
let home: string;
let app: ReturnType<typeof createHttpApp>;
let session: ReturnType<typeof createAdmissionSession>;

interface ListingBody {
  readonly path: string;
  readonly parent: string | null;
  readonly directories: readonly { readonly name: string; readonly path: string }[];
}

/** The route addresses directories, and a URL has to spell them its way. */
function browse(path: string): Promise<Response> {
  return authorized(`/api/sandbox/browse?path=${encodeURIComponent(path)}`);
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

beforeEach(() => {
  const db = openDatabase({ path: ":memory:" });
  folder = mkdtempSync(join(tmpdir(), "studio-folder-browse-"));
  home = mkdtempSync(join(tmpdir(), "studio-folder-home-"));
  // The contents the walk has to read honestly: two directories that sort
  // case-as-written, the volume's own bookkeeping, which is never a project,
  // and a file, which is not a position.
  mkdirSync(join(folder, "alpha"));
  mkdirSync(join(folder, "Beta"));
  mkdirSync(join(folder, "$Recycle.Bin"));
  writeFileSync(join(folder, "notes.txt"), "not a directory");

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
    projects: new ProjectStore(db),
    scopes: new SandboxScopeStore(db),
    database: db,
    admission: session.verifier,
    isModelServed: async () => false,
    requestShutdown: () => undefined,
    agent: probeAgent,
    browseHome: home,
  });
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("the folder browser route", () => {
  it("lists the child directories of the named directory, and only those", async () => {
    const response = await browse(folder);
    expect(response.status).toBe(200);

    const body = (await response.json()) as ListingBody;
    expect(body.directories.map((directory) => directory.name)).toEqual(["alpha", "Beta"]);
    // Every entry must be openable, which is what its path is for.
    expect(body.directories[0]?.path).toBe(join(normalizeScopePath(folder), "alpha"));
  });

  it("answers the position it listed and the way back out of it", async () => {
    const response = await browse(join(folder, "alpha", ".."));
    const body = (await response.json()) as ListingBody;

    // Normalized, so the picker's position and the next request agree.
    expect(body.path).toBe(normalizeScopePath(folder));
    expect(body.parent).toBe(dirname(normalizeScopePath(folder)));
  });

  it("refuses a relative path, which is no position on this machine", async () => {
    const response = await browse("some/folder");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/not absolute/i);
  });

  it("refuses a path that is not there", async () => {
    const response = await browse(join(folder, "absent"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/does not exist/i);
  });

  it("refuses a path that is a file, which has no inside to walk into", async () => {
    const response = await browse(join(folder, "notes.txt"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/not a directory/i);
  });

  it("opens at the configured home when no path is named", async () => {
    // The picker's first ask carries no position: the harness says where the
    // walk starts, so no surface has to know where home is to open it.
    const response = await authorized("/api/sandbox/browse");
    expect(response.status).toBe(200);

    const body = (await response.json()) as ListingBody;
    expect(body.path).toBe(normalizeScopePath(home));
  });

  it("is refused before the file system is read, without a paired credential", async () => {
    const response = await app.request("http://harness.test/api/sandbox/browse");
    expect(response.status).toBe(401);
  });
});

describe("the listing's edges", () => {
  it("reports no parent at a volume root, where up lands where you are", async () => {
    // The one position whose parent is itself - the position the native
    // picker also lets the walk pass through, and the wall does not. Guarded
    // to the platform whose root spelling this test knows; the null parent is
    // the contract either way, and the route tests above pin the rest.
    if (process.platform !== "win32") return;
    const root = browseFolders("C:\\");
    expect(root.parent).toBeNull();
    expect(root.path).toBe("C:\\");
  });
});
