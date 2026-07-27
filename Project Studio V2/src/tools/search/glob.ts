import { stat } from "node:fs/promises";

import type { CapabilityDescriptor } from "../../contracts/capabilities.js";
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
  // `read`, for the same reason as grep: ripgrep runs, but with an argument
  // vector this code built. See ADR 0013.
  effects: ["read"],
  provenance: { origin: "native", sourceId: "project-studio", trusted: true },
  idempotent: true,
};

/**
 * Orders by most recently modified.
 *
 * The file someone touched an hour ago is far more likely to be the one the
 * agent is looking for than an alphabetically earlier one it has never seen.
 * Files that cannot be stat'd sort last rather than failing the search.
 */
async function byRecency(paths: readonly string[]): Promise<string[]> {
  if (paths.length > RECENCY_SORT_CEILING) return [...paths].sort();

  const timed = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, modifiedAt: (await stat(path)).mtimeMs };
      } catch {
        return { path, modifiedAt: 0 };
      }
    }),
  );

  return timed.sort((left, right) => right.modifiedAt - left.modifiedAt).map((entry) => entry.path);
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
        path: value.path as string | undefined,
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

      const ordered = await byRecency(found);
      const page = ordered.slice(input.offset, input.offset + input.limit);
      const shown = page.map((path) => toRelative(root, path)).join("\n");

      return ordered.length > input.offset + page.length
        ? `${shown}\n\n[showing ${page.length} of ${ordered.length} files; raise limit or use offset for more]`
        : shown;
    },
  });
}
