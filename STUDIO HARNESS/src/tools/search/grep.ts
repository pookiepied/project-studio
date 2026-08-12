import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import {
  buildSearchArgs,
  parseMatches,
  runRipgrep,
  toRelative,
  type RipgrepMatch,
  type SearchOutputMode,
} from "./ripgrep.js";

/**
 * Searching file contents.
 *
 * One tool with several modes rather than several tools. "Which files mention
 * this", "show me the lines", and "how many times" are the same capability
 * asked three ways; splitting them would triple the permission surface for one
 * question.
 *
 * The filters exist for the same reason. An agent that cannot say "only .ts
 * files, ignore node_modules" ends up reading its way through the answer
 * instead, which costs the conversation far more than the search did.
 */

const DEFAULT_LIMIT: Record<SearchOutputMode, number> = {
  files: 200,
  content: 100,
  count: 200,
};

/** Long enough to see the match in context, short enough not to be a file dump. */
const MAX_LINE_LENGTH = 400;

const MAX_CONTEXT = 10;

export interface GrepInput {
  readonly pattern: string;
  readonly path: string | undefined;
  readonly outputMode: SearchOutputMode;
  readonly glob: string | undefined;
  readonly type: string | undefined;
  readonly caseInsensitive: boolean;
  readonly multiline: boolean;
  readonly contextBefore: number;
  readonly contextAfter: number;
  readonly limit: number;
  readonly offset: number;
  readonly includeIgnored: boolean;
}

export const GREP_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "grep" },
  title: "Search file contents",
  description:
    "Searches the project for a regular expression. Returns matching file paths by default; " +
    "set outputMode to content for matching lines or count for per-file totals. " +
    "Filter with glob or type, page with limit and offset, and set includeIgnored to search " +
    "ignored directories such as node_modules.",
  // A `read` capability, not `execute`. It spawns ripgrep, but with an argument
  // vector this code built from structured parameters — the model cannot supply
  // a flag. See ADR 0013.
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

function boundedInteger(
  value: unknown,
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolError("invalid_input", { message: `${name} must be a whole number.` });
  }
  if (value < bounds.min || value > bounds.max) {
    throw new ToolError("invalid_input", {
      message: `${name} must be between ${bounds.min} and ${bounds.max}.`,
    });
  }
  return value;
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError("invalid_input", { message: `${name} must be text.` });
  }
  return value;
}

function flag(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new ToolError("invalid_input", { message: `${name} must be true or false.` });
  }
  return value;
}

function clip(text: string): string {
  return text.length > MAX_LINE_LENGTH
    ? `${text.slice(0, MAX_LINE_LENGTH)}… [line truncated]`
    : text;
}

/**
 * Renders matches grouped by file.
 *
 * A match line and a context line are marked differently, so the model can tell
 * what actually matched from what merely surrounds it — without that, context
 * lines read as additional hits.
 */
export function formatMatches(root: string, matches: readonly RipgrepMatch[]): string {
  const byFile = new Map<string, RipgrepMatch[]>();
  for (const match of matches) {
    const key = toRelative(root, match.path);
    const group = byFile.get(key);
    if (group) group.push(match);
    else byFile.set(key, [match]);
  }

  const blocks: string[] = [];
  for (const [path, group] of byFile) {
    const lines = group.map(
      (match) =>
        `${String(match.lineNumber).padStart(6, " ")}${match.isMatch ? ":" : "-"} ${clip(match.text)}`,
    );
    blocks.push([path, ...lines].join("\n"));
  }

  return blocks.join("\n\n");
}

/** Renders `path:count` output from ripgrep's count mode. */
export function formatCounts(root: string, stdout: string, limit: number, offset: number): string {
  const rows = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      // Split on the *last* colon: a Windows path contains one of its own.
      const separator = line.lastIndexOf(":");
      return {
        path: toRelative(root, line.slice(0, separator)),
        count: line.slice(separator + 1),
      };
    });

  return rows
    .slice(offset, offset + limit)
    .map((row) => `${row.path}: ${row.count}`)
    .join("\n");
}

export function createGrepTool(): ToolDefinition<GrepInput, string> {
  return defineStudioTool({
    descriptor: GREP_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.pattern !== "string" || value.pattern === "") {
        throw new ToolError("invalid_input", { message: "pattern is required." });
      }

      const outputMode = value.outputMode ?? "files";
      if (outputMode !== "files" && outputMode !== "content" && outputMode !== "count") {
        throw new ToolError("invalid_input", {
          message: 'outputMode must be "files", "content", or "count".',
        });
      }

      return {
        pattern: value.pattern,
        path: optionalText(value.path, "path"),
        outputMode,
        glob: optionalText(value.glob, "glob"),
        type: optionalText(value.type, "type"),
        caseInsensitive: flag(value.caseInsensitive, "caseInsensitive"),
        multiline: flag(value.multiline, "multiline"),
        contextBefore: boundedInteger(value.contextBefore, "contextBefore", 0, {
          min: 0,
          max: MAX_CONTEXT,
        }),
        contextAfter: boundedInteger(value.contextAfter, "contextAfter", 0, {
          min: 0,
          max: MAX_CONTEXT,
        }),
        limit: boundedInteger(value.limit, "limit", DEFAULT_LIMIT[outputMode], {
          min: 1,
          max: 1_000,
        }),
        offset: boundedInteger(value.offset, "offset", 0, { min: 0, max: 100_000 }),
        includeIgnored: flag(value.includeIgnored, "includeIgnored"),
      };
    },

    // The directory being searched is what a rule scopes, and it is resolved
    // through the sandbox so a search cannot be pointed outside the workspace.
    resource: (input, context) => context.sandbox.resolveRead(input.path ?? "."),

    execute: async (input, context) => {
      const root = context.sandbox.policy.workspaceRoot;
      const searchPath = context.sandbox.resolveRead(input.path ?? ".");

      const run = await runRipgrep(
        buildSearchArgs({
          pattern: input.pattern,
          searchPath,
          outputMode: input.outputMode,
          glob: input.glob,
          type: input.type,
          caseInsensitive: input.caseInsensitive,
          multiline: input.multiline,
          contextBefore: input.contextBefore,
          contextAfter: input.contextAfter,
          includeIgnored: input.includeIgnored,
        }),
        { cwd: root, ...(context.signal ? { signal: context.signal } : {}) },
      );

      if (run.empty) {
        return input.includeIgnored
          ? "No matches."
          : "No matches. Ignored directories such as node_modules were not searched; set includeIgnored to include them.";
      }

      if (input.outputMode === "count") {
        return formatCounts(root, run.stdout, input.limit, input.offset);
      }

      if (input.outputMode === "files") {
        const paths = run.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "");
        const page = paths.slice(input.offset, input.offset + input.limit);
        const shown = page.map((path) => toRelative(root, path)).join("\n");
        return paths.length > input.offset + page.length
          ? `${shown}\n\n[showing ${page.length} of ${paths.length} files; raise limit or use offset for more]`
          : shown;
      }

      const matches = parseMatches(run.stdout);
      const page = matches.slice(input.offset, input.offset + input.limit);
      const rendered = formatMatches(root, page);

      return matches.length > input.offset + page.length
        ? `${rendered}\n\n[showing ${page.length} of ${matches.length} lines; raise limit or use offset for more]`
        : rendered;
    },
  });
}
