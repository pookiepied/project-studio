import { Hono } from "hono";
import * as v from "valibot";

import { isAbsolute } from "node:path";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import type { WorkspaceTrustStore } from "../../../permissions/trust.js";
import type { ProjectStore } from "../../../projects/store.js";
import { detectPresets } from "../../../sandbox/presets.js";
import type { SandboxScopeStore } from "../../../sandbox/scope-store.js";
import { failure, invalidBody, statusOf } from "./error-status.js";

export interface SandboxRoutesOptions {
  readonly scopes: SandboxScopeStore;
  readonly projects: ProjectStore;
  /**
   * The folder decisions. Optional the way the scope store is optional at
   * composition: a composition without it serves no trust routes and reports
   * no decisions, and production must wire it.
   */
  readonly trust?: WorkspaceTrustStore;
}

const grantSchema = v.object({
  projectId: v.optional(v.string()),
  path: v.pipe(v.string(), v.minLength(1)),
  mode: v.picklist(["read", "write"]),
  source: v.optional(v.picklist(["preset", "custom", "question"])),
  presetId: v.optional(v.string()),
});

const levelSchema = v.object({
  level: v.picklist(["contained", "trusted"]),
});

const trustSchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
  trusted: v.boolean(),
});

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw invalidBody("The request body must be valid JSON.");
  }
}

/**
 * The wall the user can move, over HTTP.
 *
 * Scope is which paths a project may reach beyond its own folder; level is
 * whether the project is contained at all. The two are kept apart here the
 * same way they are kept apart in the pane: granting a path never changes a
 * level, and choosing trusted never writes a scope row.
 *
 * Folder trust is the third thing, and it is a precondition rather than a
 * wall: until the person vouches for a folder, a conversation standing in it
 * may only read, whatever its permission mode says and whatever scope rows
 * exist. It lives here because this is the file about what a project may do
 * with the disk, but note the vocabulary collision - a `trusted` **level**
 * means uncontained, while a **trusted folder** means the person recognises
 * it. Two different answers, two different routes, never derived from each
 * other.
 *
 * The admission scope is `project`: scope and level are product state about a
 * project, not a question that speaks for the person.
 */
export function createSandboxRoutes(options: SandboxRoutesOptions): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));
  const scopes = options.scopes;
  const projects = options.projects;

  /**
   * One row per folder of a project, carrying the decision the person made
   * about it.
   *
   * Reported for every folder rather than only the first, even though a turn
   * asks about the workspace root alone: a project whose folders are half
   * vouched for is a state the person has to be able to see, and reordering
   * the folders must not silently change what the next turn may do.
   */
  function folderTrust(projectId: string) {
    const store = options.trust;
    if (store === undefined) return [];
    const folders = projects.get(projectId)?.folders ?? [];
    return folders.map((folder) => ({
      root: folder.path,
      name: folder.name,
      decision: store.decision(folder.path),
    }));
  }

  routes.get("/scope", (context) => {
    try {
      const projectId = context.req.query("projectId");
      if (projectId === undefined || projectId === "") {
        return context.json({
          project: [],
          machineWide: scopes.listMachineWide(),
          level: "contained",
          trust: [],
        });
      }
      return context.json({
        project: scopes.listProject(projectId),
        machineWide: scopes.listMachineWide(),
        level: projects.sandboxLevelOf(projectId),
        trust: folderTrust(projectId),
      });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  /**
   * The person's answer about one folder.
   *
   * Addressed by path rather than by project, because that is the unit the
   * decision is about: two projects that attach the same repository share one
   * answer, and a folder detached from a project keeps it. A refusal is a
   * write like any other - `trusted: false` records "declined", which is not
   * the same as never having been asked.
   */
  routes.put("/trust", async (context) => {
    try {
      const store = options.trust;
      if (store === undefined) return context.json({ error: "Trust is not available." }, 404);
      const parsed = v.safeParse(trustSchema, await body(context));
      if (!parsed.success) {
        throw invalidBody("A trust decision names a folder and whether it is trusted.");
      }
      const root = parsed.output.root;
      if (!isAbsolute(root)) {
        throw invalidBody("A trusted folder is named by an absolute path.");
      }
      store.set(root, parsed.output.trusted);
      return context.json({ root, decision: store.decision(root) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/scope", async (context) => {
    try {
      const parsed = v.safeParse(grantSchema, await body(context));
      if (!parsed.success) {
        throw invalidBody("A scope grant names a path and a mode.");
      }
      const row = scopes.grant({
        projectId: parsed.output.projectId ?? "",
        path: parsed.output.path,
        mode: parsed.output.mode,
        source: parsed.output.source ?? "custom",
        ...(parsed.output.presetId === undefined ? {} : { presetId: parsed.output.presetId }),
      });
      return context.json(row, 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.delete("/scope", async (context) => {
    try {
      const projectId = context.req.query("projectId") ?? "";
      const path = context.req.query("path");
      if (path === undefined || path === "") {
        throw invalidBody("Removing a scope names its path.");
      }
      const removed = scopes.revoke(projectId, path);
      if (!removed) return context.json({ error: "No such scope." }, 404);
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.get("/presets", (context) => {
    try {
      return context.json(detectPresets());
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.get("/level", (context) => {
    try {
      const projectId = context.req.query("projectId");
      if (projectId === undefined || projectId === "") {
        throw invalidBody("A level names its project.");
      }
      return context.json({ projectId, level: projects.sandboxLevelOf(projectId) });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.put("/projects/:id/level", async (context) => {
    try {
      const parsed = v.safeParse(levelSchema, await body(context));
      if (!parsed.success) {
        throw invalidBody("A sandbox level is contained or trusted.");
      }
      projects.setSandboxLevel(context.req.param("id"), parsed.output.level);
      return context.json({
        projectId: context.req.param("id"),
        level: parsed.output.level,
      });
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}
