import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SkillManagementService } from "../../src/application/skill-management.js";
import { SkillRegistry } from "../../src/extend/skills/registry.js";
import {
  ExtensionSelectionStore,
  conversationScope,
  projectScope,
} from "../../src/extend/selection.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createSkillRoutes } from "../../src/transport/http/routes/skills.js";

/**
 * Skill enablement, through the routes, one scope at a time.
 *
 * The same three facts the MCP scope tests pin, for the same reason: the
 * route is where a decision gets its scope key, and a settings control that
 * renders both kinds is built on the two spelling their answers alike. The
 * service is the real one over an in-memory store and a temporary folder, so
 * a write at the wrong width is caught by the store disagreeing, not by a
 * stub agreeing.
 */

interface Built {
  readonly db: StudioDatabase;
  readonly home: string;
  readonly selection: ExtensionSelectionStore;
  readonly app: Hono<AdmissionEnv>;
  readonly authorization: string;
}

function harness(): Built {
  const db = openDatabase({ path: ":memory:" });
  const home = mkdtempSync(join(tmpdir(), "studio-skill-routes-"));
  const selection = new ExtensionSelectionStore(db);
  const registry = new SkillRegistry({ roots: [{ directory: home, provenance: "user" }] });
  const management = new SkillManagementService({
    registry,
    selection,
    extensions: { changed: () => undefined },
    projectId: "workspace-root",
    conversationProject: (conversationId) =>
      conversationId === "filed-conversation" ? "filed-project" : undefined,
  });

  const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route("/api/skills", createSkillRoutes(management));
  return { db, home, selection, app, authorization: `Bearer ${session.credential}` };
}

function install(home: string, name = "review-pr"): void {
  mkdirSync(join(home, name));
  writeFileSync(
    join(home, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Reviews a pull request.\n---\n\nRead the diff first.\n`,
  );
}

async function decisionPut(
  app: Built["app"],
  authorization: string,
  path: string,
  enabled: unknown,
): Promise<Response> {
  return await app.request(`http://harness.test${path}`, {
    method: "PUT",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

interface Reading {
  readonly decision: boolean | null;
  readonly resolved: boolean;
  readonly decidedAt?: string;
}

interface Listing {
  readonly skills: readonly {
    readonly id: string;
    readonly description: string;
    readonly provenance: string;
    readonly enabledByDefault: boolean;
    readonly project?: Reading;
    readonly conversation?: Reading;
  }[];
  readonly problems: readonly { readonly directory: string; readonly reason: string }[];
}

async function read(app: Built["app"], authorization: string, query = ""): Promise<Listing> {
  const response = await app.request(`http://harness.test/api/skills${query}`, {
    headers: { authorization },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Listing;
}

describe("skill enablement, through the routes", () => {
  let built: Built;
  let authorization: string;

  beforeEach(() => {
    built = harness();
    authorization = built.authorization;
  });

  afterEach(() => {
    built.db.close();
    rmSync(built.home, { recursive: true, force: true });
  });

  it("lists what the folder holds, with the problems beside it", async () => {
    install(built.home);
    mkdirSync(join(built.home, "broken"));
    writeFileSync(join(built.home, "broken", "SKILL.md"), "no frontmatter\n");

    const listing = await read(built.app, authorization);
    expect(listing.skills).toEqual([
      expect.objectContaining({
        id: "review-pr",
        description: "Reviews a pull request.",
        provenance: "user",
        enabledByDefault: false,
      }),
    ]);
    expect(listing.problems).toEqual([
      { directory: join(built.home, "broken"), reason: expect.stringContaining("frontmatter") },
    ]);
    // The global read carries no narrower readings.
    expect(listing.skills[0]).not.toHaveProperty("project");
    expect(listing.skills[0]).not.toHaveProperty("conversation");
  });

  it("lands each scope's decision at its own scope, and the narrowest answers", async () => {
    install(built.home);

    expect(
      (await decisionPut(built.app, authorization, "/api/skills/extensions/skill/review-pr", true)).status,
    ).toBe(200);
    expect(
      (
        await decisionPut(
          built.app,
          authorization,
          "/api/skills/conversations/c1/extensions/skill/review-pr",
          false,
        )
      ).status,
    ).toBe(200);

    expect(
      built.selection.decisionAt({
        kind: "skill",
        extensionId: "review-pr",
        scope: conversationScope("c1"),
      }),
    ).toBe(false);
    expect(
      built.selection.decisionAt({ kind: "skill", extensionId: "review-pr", scope: projectScope("c1") }),
    ).toBeUndefined();

    const c1 = await read(built.app, authorization, "?conversationId=c1");
    expect(c1.skills[0]?.conversation).toEqual({ decision: false, resolved: false, decidedAt: "conversation" });
    expect(c1.skills[0]?.enabledByDefault).toBe(true);

    const c2 = await read(built.app, authorization, "?conversationId=c2");
    expect(c2.skills[0]?.conversation).toEqual({ decision: null, resolved: true, decidedAt: "global" });
  });

  it("clears, rather than switching off, when a scope answers inherit", async () => {
    install(built.home);
    await decisionPut(built.app, authorization, "/api/skills/extensions/skill/review-pr", true);
    await decisionPut(built.app, authorization, "/api/skills/projects/filed-project/extensions/skill/review-pr", false);

    const off = await read(built.app, authorization, "?conversationId=filed-conversation");
    expect(off.skills[0]?.conversation).toEqual({ decision: null, resolved: false, decidedAt: "project" });

    expect(
      (
        await decisionPut(
          built.app,
          authorization,
          "/api/skills/projects/filed-project/extensions/skill/review-pr",
          null,
        )
      ).status,
    ).toBe(200);
    expect(
      built.selection.decisionAt({
        kind: "skill",
        extensionId: "review-pr",
        scope: projectScope("filed-project"),
      }),
    ).toBeUndefined();

    const inherited = await read(built.app, authorization, "?projectId=filed-project");
    expect(inherited.skills[0]?.project).toEqual({ decision: null, resolved: true, decidedAt: "global" });
  });

  it("refuses a decision about a skill that is not installed, as not found", async () => {
    const response = await decisionPut(
      built.app,
      authorization,
      "/api/skills/extensions/skill/nope",
      true,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'No skill named "nope" is installed.',
      code: "extend.not_installed",
    });
    expect(built.selection.enabledIds("skill", {})).toEqual([]);
  });

  it("refuses a body that is not a decision", async () => {
    install(built.home);
    const response = await decisionPut(
      built.app,
      authorization,
      "/api/skills/extensions/skill/review-pr",
      "yes",
    );
    expect(response.status).toBe(400);
  });
});
