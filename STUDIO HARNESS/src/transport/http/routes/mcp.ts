import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { ExtendError } from "../../../extend/errors.js";
import { assertSafeMcpPayload } from "../../../extend/mcp/input-security.js";
import type { McpServerInput, McpServerRecord } from "../../../extend/mcp/registry.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type { StudioRuntime } from "../../../application/studio-runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ExtendError("internal", { message: `${field} must be a non-empty string.` });
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ExtendError("internal", { message: `${field} must be text.` });
  }
  return value;
}

function stringList(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ExtendError("internal", { message: `${field} must be a list of text.` });
  }
  return value;
}

function stringMap(value: unknown, field: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new ExtendError("internal", { message: `${field} must be an object of text.` });
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new ExtendError("internal", { message: `${field}.${key} must be text.` });
    }
    result[key] = entry;
  }
  return result;
}

function serverInput(value: unknown, idOverride?: string): McpServerInput {
  if (!isRecord(value)) {
    throw new ExtendError("internal", { message: "The MCP server body must be an object." });
  }
  assertSafeMcpPayload(value);

  const id = idOverride ?? requiredString(value["id"], "id");
  const title = requiredString(value["title"], "title");
  const transport = value["transport"];
  if (transport !== "stdio" && transport !== "http") {
    throw new ExtendError("internal", { message: "transport must be stdio or http." });
  }

  const auth = value["auth"];
  if (auth !== "none" && auth !== "bearer" && auth !== "header") {
    throw new ExtendError("internal", {
      message: "auth must be none, bearer, or header.",
    });
  }

  const command = optionalString(value["command"], "command");
  const url = optionalString(value["url"], "url");
  const authHeader = optionalString(value["authHeader"], "authHeader");
  const authEnvVar = optionalString(value["authEnvVar"], "authEnvVar");
  return {
    id,
    title,
    transport,
    ...(command === undefined ? {} : { command }),
    args: stringList(value["args"], "args"),
    env: stringMap(value["env"], "env"),
    ...(url === undefined ? {} : { url }),
    auth,
    ...(authHeader === undefined ? {} : { authHeader }),
    ...(authEnvVar === undefined ? {} : { authEnvVar }),
  };
}

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new ExtendError("internal", { message: "The request body must be valid JSON." });
  }
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

function statusOf(
  runtime: StudioRuntime,
  record: McpServerRecord,
): Record<string, unknown> {
  return {
    ...record,
    status: runtime.supervisor.status(record.id),
  };
}

export function createMcpRoutes(runtime: StudioRuntime): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.EXTENSION_MANAGEMENT));

  routes.get("/servers", (context) =>
    context.json(runtime.registry.list().map((record) => statusOf(runtime, record))),
  );

  routes.get("/servers/:id/status", (context) => {
    const id = context.req.param("id");
    const record = runtime.registry.get(id);
    if (record === undefined) return context.json({ error: "That server is not installed." }, 404);
    return context.json(statusOf(runtime, record));
  });

  routes.post("/servers", async (context) => {
    try {
      const record = runtime.management.save(serverInput(await body(context)), authContext(context));
      return context.json(statusOf(runtime, record), 201);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.patch("/servers/:id", async (context) => {
    try {
      const id = context.req.param("id");
      const current = runtime.registry.get(id);
      if (current === undefined) return context.json({ error: "That server is not installed." }, 404);
      const patch = await body(context);
      const merged = isRecord(patch) ? { ...current, ...patch, id } : patch;
      const record = runtime.management.save(serverInput(merged, id), authContext(context));
      return context.json(statusOf(runtime, record));
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/servers/:id", async (context) => {
    try {
      const removed = await runtime.management.remove(context.req.param("id"), authContext(context));
      return removed ? context.body(null, 204) : context.json({ error: "That server is not installed." }, 404);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.put(
    "/projects/:projectId/extensions/mcp/:id",
    requireAdmissionScope(ADMISSION_SCOPES.PROJECT),
    async (context) => {
      try {
        const value = await body(context);
        if (!isRecord(value) || typeof value["enabled"] !== "boolean") {
          return context.json({ error: "enabled must be a boolean.", code: "extend.internal" }, 400);
        }
        runtime.management.setEnabled(
          context.req.param("projectId"),
          context.req.param("id"),
          value["enabled"],
          authContext(context),
        );
        return context.json({ enabled: value["enabled"] });
      } catch (error) {
        return context.json(failure(error), 400);
      }
    },
  );

  routes.put("/servers/:id/credential", async (context) => {
    try {
      const value = await body(context);
      if (!isRecord(value) || typeof value["secret"] !== "string") {
        return context.json({ error: "secret must be text.", code: "credentials.invalid" }, 400);
      }
      await runtime.management.setCredential(context.req.param("id"), value["secret"], authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/servers/:id/credential", async (context) => {
    try {
      await runtime.management.deleteCredential(context.req.param("id"), authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  return routes;
}
