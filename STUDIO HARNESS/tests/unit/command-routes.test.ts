import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandRegistry } from "../../src/extend/commands/registry.js";
import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createCommandRoutes } from "../../src/transport/http/routes/commands.js";

/**
 * The commands, through their routes, over a real registry on a temporary
 * folder.
 *
 * This is the seam the webview's contract reader meets, and it had no test
 * of its own: what the listing's envelope looks like when a hint is
 * legitimately the empty string, what an expansion answers when it answers
 * nothing, and which mistakes draw 404 and which 400. Nothing here stubs the
 * registry - a stub would agree with whatever the routes assumed, which is
 * exactly what this suite is here to catch.
 */

interface Built {
  readonly home: string;
  readonly app: Hono<AdmissionEnv>;
  readonly authorization: string;
}

function harness(): Built {
  const home = mkdtempSync(join(tmpdir(), "studio-command-routes-"));
  const registry = new CommandRegistry({ roots: [{ directory: home, provenance: "user" }] });
  const session = createAdmissionSession({ scopes: ALL_ADMISSION_SCOPES });
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(session.verifier));
  app.route("/api/commands", createCommandRoutes(registry));
  return { home, app, authorization: `Bearer ${session.credential}` };
}

/** Installs one of the person's commands by hand, the way a test editor would. */
function write(home: string, name: string, text: string): void {
  writeFileSync(join(home, `${name}.md`), text, "utf8");
}

async function call(
  app: Built["app"],
  authorization: string,
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<Response> {
  return await app.request(`http://harness.test${path}`, {
    method,
    headers: {
      authorization,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

describe("the slash commands, through the routes", () => {
  let built: Built;
  let authorization: string;

  beforeEach(() => {
    built = harness();
    authorization = built.authorization;
  });

  afterEach(() => {
    rmSync(built.home, { recursive: true, force: true });
  });

  it("lists the envelope the picker reads, built-ins first and the hint as it is", async () => {
    write(
      built.home,
      "explain",
      "---\ndescription: Explain a file, a function or a concept in plain words.\nargument-hint: <what to explain>\n---\n\nExplain $ARGUMENTS.\n",
    );

    const response = await call(built.app, authorization, "/api/commands");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commands: [
        {
          id: "compact",
          description: "Compact the conversation: fold the earlier turns into a summary",
          // The built-ins' "nothing to type" is the empty string, and the
          // wire carries it as one - the answer the webview's contract once
          // refused, taking the whole listing and the picker with it.
          argumentHint: "",
          provenance: "builtin",
          kind: "action",
          path: null,
        },
        {
          id: "explain",
          description: "Explain a file, a function or a concept in plain words.",
          argumentHint: "<what to explain>",
          provenance: "user",
          kind: "prompt",
          path: join(built.home, "explain.md"),
        },
      ],
      problems: [],
      userDirectory: built.home,
    });
  });

  it("expands through the registry, and a $1-only command answers the empty string", async () => {
    write(built.home, "echo", "$1");

    const asked = await call(built.app, authorization, "/api/commands/echo/expand", "POST", {
      arguments: "hello world",
    });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ text: "hello" });

    // The answer that once failed the webview's contract: a body that is
    // only $1, expanded against no arguments, answers the empty string - a
    // real answer, not a missing one.
    const silent = await call(built.app, authorization, "/api/commands/echo/expand", "POST", {});
    expect(silent.status).toBe(200);
    expect(await silent.json()).toEqual({ text: "" });
  });

  it("answers what is not there as not found, and what cannot be, as its own 400", async () => {
    const missing = await call(built.app, authorization, "/api/commands/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'No command named "nope" exists.',
      code: "extend.not_installed",
    });

    // A built-in is not the person's to remove: the other arm of the
    // mapping, where not_installed draws 404 and the extend spine's
    // everything-else draws 400.
    const removed = await call(built.app, authorization, "/api/commands/compact", "DELETE");
    expect(removed.status).toBe(400);
    expect(await removed.json()).toEqual({
      error: '"/compact" is not one of your own commands and cannot be removed here.',
      code: "extend.invalid",
    });
  });

  it("writes one of the person's own commands, and refuses what it cannot read", async () => {
    const saved = await call(built.app, authorization, "/api/commands/note-it", "PUT", {
      description: "Note the thing.",
      argumentHint: "",
      body: "Remember $ARGUMENTS.",
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      command: {
        id: "note-it",
        description: "Note the thing.",
        // The hint, being nothing, rounds the trip: written as no field at
        // all, read back as the empty string.
        argumentHint: "",
        provenance: "user",
        kind: "prompt",
        path: join(built.home, "note-it.md"),
      },
    });
    // A real file, in the folder a hand-written one would land in.
    expect(existsSync(join(built.home, "note-it.md"))).toBe(true);

    // No prompt, no command: the body's one required half.
    const hintless = await call(built.app, authorization, "/api/commands/note-it", "PUT", {
      description: "No prompt.",
    });
    expect(hintless.status).toBe(400);

    // Nor a body that is not JSON at all.
    const unreadable = await built.app.request("http://harness.test/api/commands/note-it", {
      method: "PUT",
      headers: { authorization, "content-type": "application/json" },
      body: "not json",
    });
    expect(unreadable.status).toBe(400);
  });
});
