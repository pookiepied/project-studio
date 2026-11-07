import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { locateConversationFile, readConversationText } from "../../src/conversations/files.js";
import { conversationDirectory } from "../../src/platform/paths.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createFileRoutes } from "../../src/transport/http/routes/files.js";

/** How a reply's loose words become a real path, and where that must stop. */

const ID = "cnv_files";

let base: string;
let project: string;
let priorHome: string | undefined;

function put(path: string, contents: string | Buffer = "text"): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return realpathSync(path);
}

const home = (...segments: string[]) => join(conversationDirectory(ID), ...segments);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "studio-files-"));
  project = join(base, "project");
  mkdirSync(project);
  priorHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(base, "home");
  for (const folder of ["workspace", "scratch", "artifacts", "attachments"]) mkdirSync(home(folder), { recursive: true });
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = priorHome;
  rmSync(base, { recursive: true, force: true });
});

describe("locating a file a reply named", () => {
  it("finds a bare name in a conversation with no project", async () => {
    const real = put(home("workspace", "climate-change.md"));
    expect(await locateConversationFile(ID, "climate-change.md", [])).toEqual({ path: real, kind: "file", others: 0 });
  });

  it("finds a name in the conversation's other places", async () => {
    const real = put(home("scratch", "draft.txt"));
    expect((await locateConversationFile(ID, "draft.txt", []))?.path).toBe(real);
  });

  it("stands in the project's first folder", async () => {
    const real = put(join(project, "docs", "readme.md"));
    expect((await locateConversationFile(ID, "docs/readme.md", [project]))?.path).toBe(real);
  });

  it("finds a name the reply gave without its folders", async () => {
    const real = put(join(project, "src", "deep", "app.ts"));
    expect((await locateConversationFile(ID, "app.ts", [project]))?.path).toBe(real);
    expect((await locateConversationFile(ID, "deep/app.ts", [project]))?.path).toBe(real);
    expect((await locateConversationFile(ID, "deep\\app.ts", [project]))?.path).toBe(real);
  });

  it("ignores case, as Windows does", async () => {
    const real = put(home("workspace", "Report.MD"));
    expect((await locateConversationFile(ID, "report.md", []))?.path).toBe(real);
  });

  it("reads a sandbox path by what follows its root", async () => {
    const real = put(home("workspace", "notes.md"));
    expect((await locateConversationFile(ID, "/workspace/notes.md", []))?.path).toBe(real);
  });

  it("prefers an exact path to a search", async () => {
    const exact = put(join(project, "notes.md"));
    put(join(project, "archive", "notes.md"));
    expect(await locateConversationFile(ID, "notes.md", [project])).toEqual({ path: exact, kind: "file", others: 0 });
  });

  it("answers with the newest of several, and counts the rest", async () => {
    const older = put(join(project, "a", "notes.md"));
    const newer = put(join(project, "b", "notes.md"));
    utimesSync(older, new Date(1_000), new Date(1_000));
    expect(await locateConversationFile(ID, "notes.md", [project])).toEqual({ path: newer, kind: "file", others: 1 });
  });

  it("finds a folder and says it is one", async () => {
    put(join(project, "src", "app.ts"));
    expect((await locateConversationFile(ID, "src", [project]))?.kind).toBe("folder");
  });

  it("does not go looking in dependencies", async () => {
    put(join(project, "node_modules", "pkg", "only-here.md"));
    expect(await locateConversationFile(ID, "only-here.md", [project])).toBeNull();
  });

  it("answers null for a name nothing fits", async () => {
    expect(await locateConversationFile(ID, "absent.md", [project])).toBeNull();
  });

  it("does not confirm a file outside the conversation", async () => {
    const outside = put(join(base, "outside", "secret.md"));
    expect(await locateConversationFile(ID, outside, [project])).toBeNull();
    expect(await locateConversationFile(ID, "../outside/secret.md", [project])).toBeNull();
    expect(await locateConversationFile(ID, "secret.md", [project])).toBeNull();
  });

  it("does not follow a link out of the conversation", async (context) => {
    const outside = put(join(base, "outside", "secret.md"));
    try {
      symlinkSync(outside, join(project, "link.md"));
    } catch {
      context.skip(); // Windows needs a privilege to make one.
    }
    expect(await locateConversationFile(ID, "link.md", [project])).toBeNull();
    expect(await readConversationText(ID, join(project, "link.md"), [project])).toBeNull();
  });
});

describe("reading a file for the viewer", () => {
  it("returns a located file's text", async () => {
    const real = put(home("workspace", "notes.md"), "# Notes\n");
    expect(await readConversationText(ID, real, [])).toEqual({ text: "# Notes\n", truncated: false });
  });

  it("cuts a long file at a whole line and says so", async () => {
    const real = put(home("workspace", "long.txt"), "line\n".repeat(400_000));
    const read = await readConversationText(ID, real, []);
    expect(read?.truncated).toBe(true);
    expect(read?.text.endsWith("line")).toBe(true);
    expect(read?.text.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it("declines a binary file", async () => {
    const real = put(home("workspace", "data.txt"), Buffer.from([0x68, 0x00, 0x69]));
    expect(await readConversationText(ID, real, [])).toBeNull();
  });

  it.each([".env", ".env.local", "server.pem", "id.key", "cert.pfx"])("declines the credential %s", async (name) => {
    const real = put(join(project, name), "SECRET=1");
    expect(await readConversationText(ID, real, [project])).toBeNull();
  });

  it("declines a file outside the conversation", async () => {
    const outside = put(join(base, "outside", "notes.md"));
    expect(await readConversationText(ID, outside, [project])).toBeNull();
  });

  it("declines a folder", async () => {
    expect(await readConversationText(ID, realpathSync(project), [project])).toBeNull();
  });
});

describe("the file routes", () => {
  function build(scopes = ALL_ADMISSION_SCOPES) {
    const session = createAdmissionSession({ scopes });
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/files", createFileRoutes({ projectFolders: () => [project] }));
    return (path: string) => app.request(`http://harness.test${path}`, {
      headers: { authorization: `Bearer ${session.credential}` },
    });
  }

  it("answers a found file and a missing one with the same status", async () => {
    const real = put(join(project, "notes.md"));
    const get = build();
    const found = await get(`/api/files/${ID}/locate?path=notes.md`);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ location: { path: real, kind: "file", others: 0 } });
    const missing = await get(`/api/files/${ID}/locate?path=absent.md`);
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ location: null });
  });

  it("serves text and is not cached", async () => {
    const real = put(join(project, "notes.md"), "hello");
    const response = await build()(`/api/files/${ID}/text?path=${encodeURIComponent(real)}`);
    expect(await response.json()).toEqual({ file: { text: "hello", truncated: false } });
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("refuses a malformed request", async () => {
    const get = build();
    expect((await get(`/api/files/${ID}/locate`)).status).toBe(400);
    expect((await get(`/api/files/bad%20id/locate?path=a.md`)).status).toBe(400);
  });

  it("requires admission", async () => {
    const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/files", createFileRoutes({ projectFolders: () => [] }));
    expect((await app.request(`http://harness.test/api/files/${ID}/locate?path=a.md`)).status).toBe(401);
  });
});
