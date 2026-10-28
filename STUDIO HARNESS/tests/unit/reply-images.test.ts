import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import type { MediaAdministration } from "../../src/gateway/media/service.js";
import type { HttpBinaryResponse } from "../../src/net/http.js";
import { conversationScratchDirectory, conversationWorkspaceDirectory } from "../../src/platform/paths.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createMediaRoutes } from "../../src/transport/http/routes/media.js";
import { createWebRoutes } from "../../src/transport/http/routes/web.js";
import { WebImageProxy } from "../../src/web/images.js";

/**
 * The pictures a reply embeds: a file the conversation saved, served only
 * from the places the conversation works in, and an image on the web,
 * fetched by the harness so the window never asks the host.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let root: string;
let previousHome: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-reply-images-"));
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(root, "home");
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

function routed(projectFolders: readonly string[] = []) {
  const session = createAdmissionSession();
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  const media: MediaAdministration = {
    transcribe: async () => ({ text: "unused" }),
    speak: async () => ({ audio: "", mimeType: "audio/wav" }),
  };
  app.route("/api/media", createMediaRoutes(media, { projectFolders: () => projectFolders }));
  const headers = { authorization: `Bearer ${session.credential}` };
  const picture = (path: string) =>
    app.request(`http://harness.test/api/media/workspace/cnv-1?path=${encodeURIComponent(path)}`, { headers });
  return { picture };
}

describe("a conversation's own pictures", () => {
  it("serves a saved picture by the path the reply wrote", async () => {
    const workspace = conversationWorkspaceDirectory("cnv-1");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "chart.png"), PNG);
    const { picture } = routed();

    for (const path of ["chart.png", "workspace/chart.png", join(workspace, "chart.png")]) {
      const response = await picture(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    }
  });

  it("serves from scratch and from the project's folders", async () => {
    const project = join(root, "repo");
    await mkdir(join(project, "docs"), { recursive: true });
    await writeFile(join(project, "docs", "shot.webp"), PNG);
    await mkdir(conversationScratchDirectory("cnv-1"), { recursive: true });
    await writeFile(join(conversationScratchDirectory("cnv-1"), "plot.png"), PNG);
    const { picture } = routed([project]);

    expect((await picture("docs/shot.webp")).status).toBe(200);
    expect((await picture("scratch/plot.png")).status).toBe(200);
  });

  it("reads file URLs containing reserved filename characters", async () => {
    const workspace = conversationWorkspaceDirectory("cnv-1");
    await mkdir(workspace, { recursive: true });
    const path = join(workspace, "chart #1.png");
    await writeFile(path, PNG);
    expect((await routed().picture(pathToFileURL(path).href)).status).toBe(200);
  });

  it("refuses a linked directory that leaves the conversation's roots", async () => {
    const workspace = conversationWorkspaceDirectory("cnv-1");
    const outside = join(root, "private");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "chart.png"), PNG);
    await symlink(outside, join(workspace, "linked"), "junction");
    expect((await routed().picture("linked/chart.png")).status).toBe(404);
  });

  it("refuses anything outside the conversation, and anything that is not a picture", async () => {
    const workspace = conversationWorkspaceDirectory("cnv-1");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "notes.txt"), "secret");
    await writeFile(join(root, "outside.png"), PNG);
    const { picture } = routed();

    expect((await picture("notes.txt")).status).toBe(404);
    expect((await picture("../../../../outside.png")).status).toBe(404);
    expect((await picture(join(root, "outside.png"))).status).toBe(404);
    expect((await picture("missing.png")).status).toBe(404);
  });
});

describe("pictures from the web", () => {
  function web(answer: (url: string) => HttpBinaryResponse) {
    const asked: string[] = [];
    const images = new WebImageProxy({
      requestBinary: async (options) => {
        asked.push(options.url);
        return answer(options.url);
      },
    });
    const app = new Hono<AdmissionEnv>();
    const session = createAdmissionSession();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/web", createWebRoutes({ lookup: async () => null }, images));
    const image = (url: string) =>
      app.request(`http://harness.test/api/web/image?url=${encodeURIComponent(url)}`, {
        headers: { authorization: `Bearer ${session.credential}` },
      });
    return { image, asked };
  }

  it("fetches an image once and serves it by what its bytes say it is", async () => {
    const { image, asked } = web((url) => ({ status: 200, headers: { "content-type": "text/plain" }, bytes: PNG, url }));
    const first = await image("https://images.example.com/a.png");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    await image("https://images.example.com/a.png");
    expect(asked).toEqual(["https://images.example.com/a.png"]);
  });

  it("refuses bytes that are not an image, private hosts, and other schemes", async () => {
    const { image, asked } = web((url) => ({ status: 200, headers: {}, bytes: Buffer.from("<html>"), url }));
    expect((await image("https://example.com/page")).status).toBe(404);
    expect((await image("http://127.0.0.1/a.png")).status).toBe(404);
    expect((await image("http://localhost/a.png")).status).toBe(404);
    expect((await image("ftp://example.com/a.png")).status).toBe(404);
    expect(asked).toEqual(["https://example.com/page"]);
  });
});
