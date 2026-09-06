import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { buildFilesArgs, runRipgrep, toRelative } from "./ripgrep.js";

/**
 * Finding files by name.
 *
 * This is also the directory listing: `src/*` lists a directory, `**\/*.ts`
 * finds every TypeScript file. A separate `list` tool would be a second way to
 * ask one question, and a second permission surface for it.
 */

const DEFAULT_LIMIT = 200;

/**
 * Above this many results, ordering by modification time costs one filesystem
 * call per file for an answer nobody reads to the end.
 */
const RECENCY_SORT_CEILING = 1_000;

export interface GlobInput {
  readonly pattern: string;
  readonly path: string | undefined;
  readonly limit: number;
  readonly offset: number;
  readonly includeIgnored: boolean;
}

export const GLOB_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "glob" },
  title: "Find files",
  description:
    "Finds files by name pattern, most recently modified first. Use src/* to list a directory " +
    "and **/*.ts to match by extension. Page with limit and offset, and set includeIgnored to " +
    "include ignored directories such as node_modules.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", minLength: 1 },
      path: { type: "string" },
      limit: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      includeIgnored: { type: "boolean" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  // `read`, for the same reason as grep: ripgrep runs, but with an argument
  // vector this code built. See ADR 0013.
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

interface OrderedPaths {
  readonly paths: readonly string[];
  /** What the order actually is, so the caller can say so. */
  readonly order: "recency" | "name";
}

/**
 * Orders by most recently modified.
 *
 * The file someone touched an hour ago is far more likely to be the one the
 * agent is looking for than an alphabetically earlier one it has never seen.
 * Files that cannot be stat'd sort last rather than failing the search.
 *
 * Above the ceiling it orders by name instead, and **says so** in the returned
 * `order`. The tool description promises "most recently modified first"; a
 * result that silently means something else on large searches is a lie the
 * model has no way to detect.
 *
 * `stat` goes through the sandbox rather than `node:fs/promises`, like every
 * other filesystem call in the harness. Directly, it would follow a symlink and
 * read the modification time of a target outside the workspace — a small leak,
 * but a leak through the one path that skipped containment.
 */
async function byRecency(
  paths: readonly string[],
  sandbox: { stat(path: string): Promise<{ modifiedAt: number }> },
): Promise<OrderedPaths> {
  if (paths.length > RECENCY_SORT_CEILING) {
    return { paths: [...paths].sort(), order: "name" };
  }

  const timed = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, modifiedAt: (await sandbox.stat(path)).modifiedAt };
      } catch {
        return { path, modifiedAt: 0 };
      }
    }),
  );

  return {
    paths: timed
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .map((entry) => entry.path),
    order: "recency",
  };
}

export function createGlobTool(): ToolDefinition<GlobInput, string> {
  return defineStudioTool({
    descriptor: GLOB_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.pattern !== "string" || value.pattern.trim() === "") {
        throw new ToolError("invalid_input", { message: "pattern is required." });
      }
      if (value.path !== undefined && typeof value.path !== "string") {
        throw new ToolError("invalid_input", { message: "path must be text." });
      }
      for (const [name, bound] of [
        ["limit", 1_000],
        ["offset", 100_000],
      ] as const) {
        const given = value[name];
        if (
          given !== undefined &&
          (typeof given !== "number" || !Number.isInteger(given) || given < 0 || given > bound)
        ) {
          throw new ToolError("invalid_input", {
            message: `${name} must be a whole number no greater than ${bound}.`,
          });
        }
      }
      if (value.includeIgnored !== undefined && typeof value.includeIgnored !== "boolean") {
        throw new ToolError("invalid_input", {
          message: "includeIgnored must be true or false.",
        });
      }

      return {
        pattern: value.pattern,
        path: value.path,
        limit: (value.limit as number | undefined) ?? DEFAULT_LIMIT,
        offset: (value.offset as number | undefined) ?? 0,
        includeIgnored: value.includeIgnored === true,
      };
    },

    resource: (input, context) => context.sandbox.resolveRead(input.path ?? "."),

    execute: async (input, context) => {
      const root = context.sandbox.policy.workspaceRoot;
      const searchPath = context.sandbox.resolveRead(input.path ?? ".");

      const run = await runRipgrep(
        buildFilesArgs({
          pattern: input.pattern,
          searchPath,
          includeIgnored: input.includeIgnored,
        }),
        { cwd: root, ...(context.signal ? { signal: context.signal } : {}) },
      );

      if (run.empty) {
        return input.includeIgnored
          ? "No files matched."
          : "No files matched. Ignored directories such as node_modules were not searched; set includeIgnored to include them.";
      }

      const found = run.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");

      const { paths: ordered, order } = await byRecency(found, context.sandbox);
      const page = ordered.slice(input.offset, input.offset + input.limit);
      const shown = page.map((path) => toRelative(root, path)).join("\n");

      const notes: string[] = [];
      if (ordered.length > input.offset + page.length) {
        notes.push(
          `showing ${page.length} of ${ordered.length} files; raise limit or use offset for more`,
        );
      }
      // Only when it is not what the description promised. Saying "sorted by
      // recency" on every ordinary result would be a token cost paid for
      // nothing.
      if (order === "name") {
        notes.push(
          `sorted by name, not by modified time: ${ordered.length} matches is above the ${RECENCY_SORT_CEILING} limit for reading modification times`,
        );
      }

      return notes.length === 0 ? shown : `${shown}\n\n[${notes.join("; ")}]`;
    },
  });
}
