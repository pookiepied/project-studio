import { Hono } from "hono";
import * as v from "valibot";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { ExtendError } from "../../../extend/errors.js";
import type { CommandRegistry } from "../../../extend/commands/registry.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * `/api/commands`: the slash commands, the files that failed to be one, and
 * the person's own commands as they write them.
 *
 * Skills' routes with a writer added: a command is one small text file, and
 * a settings pane that can only point at a folder would send a person to a
 * text editor to add a sentence. So the person's own commands can be
 * written and removed here, into the same folder a hand-written file goes
 * in; shipped and built-in commands cannot, because they are not the
 * person's to change. Expansion is a route too, so the webview never has
 * to reimplement the substitution rules.
 */

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

function statusFor(error: unknown): 400 | 404 {
  return error instanceof ExtendError && error.kind === "not_installed" ? 404 : 400;
}

const saveSchema = v.object({
  description: v.optional(v.string()),
  argumentHint: v.optional(v.string()),
  body: v.string(),
});

const expandSchema = v.object({
  arguments: v.optional(v.string()),
});

async function body<T>(context: { req: { json(): Promise<unknown> } }, schema: v.GenericSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await context.req.json();
  } catch {
    throw new ExtendError("invalid", { message: "The request body must be valid JSON." });
  }
  const result = v.safeParse(schema, raw);
  if (!result.success) {
    throw new ExtendError("invalid", { message: "The request body does not match what this route takes." });
  }
  return result.output;
}

export function createCommandRoutes(commands: CommandRegistry): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.EXTENSION_MANAGEMENT));

  routes.get("/", (context) => {
    const list = commands.list();
    return context.json({
      commands: list,
      problems: commands.problems(),
      userDirectory: commands.userDirectory,
    });
  });

  routes.get("/:id", (context) => {
    try {
      const id = context.req.param("id");
      const record = commands.get(id);
      if (record === undefined) {
        throw new ExtendError("not_installed", { message: `No command named "${id}" exists.` });
      }
      const source = record.kind === "prompt" ? commands.source(id) : null;
      return context.json({ command: record, source });
    } catch (error) {
      return context.json(failure(error), statusFor(error));
    }
  });

  routes.put("/:id", async (context) => {
    try {
      const parsed = await body(context, saveSchema);
      const saved = commands.save(context.req.param("id"), {
        frontmatter: {
          description: parsed.description ?? "",
          argumentHint: parsed.argumentHint ?? "",
        },
        body: parsed.body,
      });
      return context.json({ command: saved });
    } catch (error) {
      return context.json(failure(error), statusFor(error));
    }
  });

  routes.delete("/:id", (context) => {
    try {
      commands.remove(context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return context.json(failure(error), statusFor(error));
    }
  });

  routes.post("/:id/expand", async (context) => {
    try {
      const parsed = await body(context, expandSchema);
      const text = commands.expand(context.req.param("id"), parsed.arguments ?? "");
      return context.json({ text });
    } catch (error) {
      return context.json(failure(error), statusFor(error));
    }
  });

  return routes;
}
