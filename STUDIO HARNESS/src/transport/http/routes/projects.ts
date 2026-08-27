import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import {
  projectCreateSchema,
  projectPatchSchema,
  projectFolderSpecSchema,
} from "../../../contracts/conversations.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import type { ProjectStore } from "../../../projects/store.js";
import { failure, invalidBody, statusOf } from "./error-status.js";

export interface ProjectRoutesOptions {
  /** The owner of `project` and `project_folder`. */
  readonly projects: ProjectStore;
}

function parseBody<T>(schema: v.GenericSchema<T>, value: unknown): T {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    throw invalidBody("The project body does not match the contract.");
  }
  return result.output;
}

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw invalidBody("The request body must be valid JSON.");
  }
}

/**
 * Projects and their folders over HTTP.
 *
 * Folders are nested resources on purpose: they exist only under a project,
 * so there is no /api/folders pretending otherwise. Every route requires the
 * `project` admission scope.
 */
export function createProjectRoutes(options: ProjectRoutesOptions): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));
  const store = options.projects;

  routes.get("/", (context) => context.json(store.list()));

  routes.post("/", async (context) => {
    try {
      const input = parseBody(projectCreateSchema, await body(context));
      return context.json(store.create(input), 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.patch("/:id", async (context) => {
    try {
      const change = parseBody(projectPatchSchema, await body(context));
      store.patch(context.req.param("id"), change);
      const updated = store.get(context.req.param("id"));
      if (updated === undefined) return context.json({ error: "No such project." }, 404);
      return context.json(updated);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Removing a project detaches its conversations rather than deleting them:
  // `ON DELETE SET NULL` is what makes that structural. Folder rows cascade;
  // a folder shared with another project keeps that other row.
  routes.delete("/:id", (context) => {
    try {
      store.remove(context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  routes.post("/:id/folders", async (context) => {
    try {
      const folder = parseBody(projectFolderSpecSchema, await body(context));
      const updated = store.addFolder(context.req.param("id"), folder);
      if (updated === undefined) return context.json({ error: "No such project." }, 404);
      return context.json(updated, 201);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Renaming or relocating one folder. Relocation rewrites the path; grants
  // that referred to the old pattern are deliberately left alone to expire,
  // because pointing an existing approval at a different directory without
  // asking again is how approvals start meaning more than they showed.
  routes.patch("/:id/folders/:folderId", async (context) => {
    try {
      const change = parseBody(
        v.partial(projectFolderSpecSchema),
        await body(context),
      );
      store.updateFolder(context.req.param("folderId"), change);
      const updated = store.get(context.req.param("id"));
      if (updated === undefined) return context.json({ error: "No such project." }, 404);
      return context.json(updated);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  // Taking a folder away takes its access away with it at the next turn bind.
  routes.delete("/:id/folders/:folderId", (context) => {
    try {
      store.removeFolder(context.req.param("folderId"));
      const updated = store.get(context.req.param("id"));
      if (updated === undefined) return context.json({ error: "No such project." }, 404);
      return context.json(updated);
    } catch (error) {
      return context.json(failure(error), statusOf(error));
    }
  });

  return routes;
}
