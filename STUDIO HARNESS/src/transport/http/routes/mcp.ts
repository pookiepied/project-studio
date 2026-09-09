import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { ExtendError } from "../../../extend/errors.js";
import { assertSafeMcpPayload } from "../../../extend/mcp/input-security.js";
import type { McpServerInput } from "../../../extend/mcp/registry.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type { McpAdministration, McpReadContext } from "../../../application/mcp-management.js";
import { GLOBAL_SCOPE, conversationScope, projectScope } from "../../../extend/selection.js";

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
  if (!Array.isArray(value)) {
    throw new ExtendError("internal", { message: `${field} must be a list of text.` });
  }
  // Filtered rather than asserted: the refusal below fires on exactly the
  // same input the `some` check used to refuse, and what is returned is
  // provably a list of strings rather than an `any[]` that was checked once.
  const entries: unknown[] = value;
  const strings = entries.filter((entry): entry is string => typeof entry === "string");
  if (strings.length !== entries.length) {
    throw new ExtendError("internal", { message: `${field} must be a list of text.` });
  }
  return strings;
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

  // Absent and empty are the same thing here, and both mean "nobody has
  // written a purpose sentence". A `PATCH` that clears the field sends the
  // empty string, and it must land as the empty string rather than as a
  // missing key that the registry's default would then fill back in.
  const description = optionalString(value["description"], "description");

  // `provenance` says who wrote a server, and nothing outside this process may
  // claim to have written one. It is refused here rather than coerced, and
  // "system" is refused outright rather than accepted, because that word now
  // decides a boundary: a system server is Studio's own code and is launched
  // without containment (see `extend/mcp/launcher.ts`), on the reasoning that
  // containment answers "whose program is this". A route that let a caller
  // answer that question for itself would hand any program on the machine an
  // uncontained launch for the price of one extra field.
  //
  // The only writer of "system" is `registerBuiltInServers`, which runs inside
  // the harness with a path it computed itself. Everything that arrives over
  // HTTP is somebody's installation, which is exactly what "user" means.
  const provenance = value["provenance"];
  if (provenance !== undefined && provenance !== "user") {
    throw new ExtendError("internal", {
      message:
        provenance === "system"
          ? "Only Studio's own capabilities are system servers, and they are not installed this way."
          : "provenance must be user.",
    });
  }

  // Read rather than defaulted, because the registry's default is `true` and
  // this field is the one that withholds a network. Dropping it here meant
  // every server was saved with a network however the form's switch was set,
  // which is a boundary the screen showed and the harness was not applying.
  const needsNetwork = value["needsNetwork"];
  if (needsNetwork !== undefined && typeof needsNetwork !== "boolean") {
    throw new ExtendError("internal", {
      message: "needsNetwork must be true or false.",
    });
  }

  const command = optionalString(value["command"], "command");
  const url = optionalString(value["url"], "url");
  const authHeader = optionalString(value["authHeader"], "authHeader");
  const authEnvVar = optionalString(value["authEnvVar"], "authEnvVar");
  return {
    id,
    title,
    ...(description === undefined ? {} : { description }),
    ...(provenance === undefined ? {} : { provenance }),
    transport,
    ...(command === undefined ? {} : { command }),
    args: stringList(value["args"], "args"),
    env: stringMap(value["env"], "env"),
    ...(url === undefined ? {} : { url }),
    auth,
    ...(authHeader === undefined ? {} : { authHeader }),
    ...(authEnvVar === undefined ? {} : { authEnvVar }),
    ...(needsNetwork === undefined ? {} : { needsNetwork }),
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

/**
 * Which narrower context the list should answer for, from the query string.
 *
 * Absent or empty means the default question - the global read - whose rows
 * carry no readings, because the global settings edit the default itself. An
 * unknown project or conversation id still answers, with an absent decision
 * and whatever the wider scopes resolve: the selection store carries no
 * registry of scopes, so there is nothing here to 404, and the wider answer
 * is the true one for a context nobody has decided about yet.
 */
function readContext(context: { req: { query(name: string): string | undefined } }): McpReadContext {
  const projectId = context.req.query("projectId");
  const conversationId = context.req.query("conversationId");
  return {
    ...(projectId === undefined || projectId === "" ? {} : { projectId }),
    ...(conversationId === undefined || conversationId === "" ? {} : { conversationId }),
  };
}

export function createMcpRoutes(servers: McpAdministration): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.EXTENSION_MANAGEMENT));

  routes.get("/servers", (context) => context.json(servers.list(readContext(context))));

  routes.get("/servers/:id/status", (context) => {
    const record = servers.get(context.req.param("id"));
    if (record === undefined) return context.json({ error: "That server is not installed." }, 404);
    return context.json(record);
  });

  routes.post("/servers", async (context) => {
    try {
      const record = servers.save(serverInput(await body(context)), authContext(context));
      return context.json(record, 201);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.patch("/servers/:id", async (context) => {
    try {
      const id = context.req.param("id");
      const current = servers.get(id);
      if (current === undefined) return context.json({ error: "That server is not installed." }, 404);
      const patch = await body(context);
      const merged = isRecord(patch) ? { ...current, ...patch, id } : patch;
      const record = servers.save(serverInput(merged, id), authContext(context));
      return context.json(record);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/servers/:id", async (context) => {
    try {
      const removed = await servers.remove(context.req.param("id"), authContext(context));
      return removed ? context.body(null, 204) : context.json({ error: "That server is not installed." }, 404);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  /**
   * The decision body, for every scope.
   *
   * `enabled` is a boolean or `null`, and `null` is not a spelling of `false`:
   * it clears the decision at this scope so the wider one applies again. A
   * project that has been switched off inherits nothing; a project that has
   * been CLEARED inherits the user's default. Only the caller knows which was
   * meant, so both have to be sendable.
   */
  function decision(value: unknown): boolean | null {
    if (!isRecord(value)) {
      throw new ExtendError("internal", { message: "The body must be an object." });
    }
    const enabled = value["enabled"];
    if (enabled === null || typeof enabled === "boolean") return enabled;
    throw new ExtendError("internal", {
      message: "enabled must be true, false, or null to inherit.",
    });
  }

  // The user's default, inherited by every project and conversation that has
  // not decided for itself. This is the only place the global scope can be
  // written: a global change made from inside one project or one conversation
  // is a change someone did not know they were making.
  routes.put("/extensions/mcp/:id", async (context) => {
    try {
      const enabled = decision(await body(context));
      servers.setEnabled(
        GLOBAL_SCOPE,
        context.req.param("id"),
        enabled,
        authContext(context),
      );
      return context.json({ enabled });
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.put(
    "/projects/:projectId/extensions/mcp/:id",
    requireAdmissionScope(ADMISSION_SCOPES.PROJECT),
    async (context) => {
      try {
        const enabled = decision(await body(context));
        servers.setEnabled(
          projectScope(context.req.param("projectId")),
          context.req.param("id"),
          enabled,
          authContext(context),
        );
        return context.json({ enabled });
      } catch (error) {
        return context.json(failure(error), 400);
      }
    },
  );

  // The conversation's own decision, written from the conversation's own
  // surface - the narrowest scope of the three, and deliberately the last one
  // given a route, because it is the one with the least evidence of being
  // needed. It mirrors the project route exactly on purpose: the body, the
  // validation and the errors are the same, because a person switching an
  // extension off for this conversation is asking the same question a project
  // asks, one step narrower. What the conversation route cannot do is reach
  // past its own scope: a conversation change reachable from a project screen
  // would be a change someone did not know they were making, which is the
  // same argument that keeps the project screen off the global scope.
  routes.put(
    "/conversations/:conversationId/extensions/mcp/:id",
    requireAdmissionScope(ADMISSION_SCOPES.PROJECT),
    async (context) => {
      try {
        const enabled = decision(await body(context));
        servers.setEnabled(
          conversationScope(context.req.param("conversationId")),
          context.req.param("id"),
          enabled,
          authContext(context),
        );
        return context.json({ enabled });
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
      await servers.setCredential(context.req.param("id"), value["secret"], authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/servers/:id/credential", async (context) => {
    try {
      await servers.deleteCredential(context.req.param("id"), authContext(context));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  return routes;
}
