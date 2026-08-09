import type { CapabilityDescriptor } from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import type { FileAccessLog } from "./access-log.js";

/**
 * Reading a file, the way a model can actually use it.
 *
 * Line numbers are not decoration: they are how the model refers to a location
 * afterwards, and how a person checks that a proposed edit points where it
 * claims. The limits exist because a file large enough to fill the context
 * window costs the conversation more than it returns.
 */

/** A window, not a whole file. The model asks again for more. */
const DEFAULT_LINE_LIMIT = 2_000;

/** Beyond this a "line" is machine output, not something to reason about. */
const MAX_LINE_LENGTH = 2_000;

/** 1 MiB. A larger file is a data file, and belongs to a search, not a read. */
const MAX_FILE_BYTES = 1024 * 1024;

export interface ReadInput {
  readonly path: string;
  /** 1-based first line to return. */
  readonly offset: number;
  readonly limit: number;
}

export const READ_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "read" },
  title: "Read file",
  description:
    "Reads a file from the project, returning numbered lines. Use offset and limit to page through a long file.",
  effects: ["read"],
  provenance: { origin: "native", sourceId: "project-studio", trusted: true },
  idempotent: true,
};

function positiveInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ToolError("invalid_input", {
      message: `${name} must be a whole number of 1 or more.`,
    });
  }
  return value;
}

/**
 * Formats content the way `cat -n` does, so a line number in the output means
 * the same thing as a line number in an editor.
 */
export function formatNumbered(content: string, offset: number, limit: number): string {
  if (content === "") return "(this file is empty)";

  const lines = content.split(/\r?\n/);
  // A trailing newline produces a final empty element that is not a line.
  if (lines.at(-1) === "") lines.pop();

  const start = Math.min(offset - 1, lines.length);
  const window = lines.slice(start, start + limit);

  const numbered = window.map((line, index) => {
    const number = String(start + index + 1).padStart(6, " ");
    const text =
      line.length > MAX_LINE_LENGTH
        ? `${line.slice(0, MAX_LINE_LENGTH)}… [line truncated]`
        : line;
    return `${number}\t${text}`;
  });

  const shown = start + window.length;
  if (shown < lines.length) {
    // Stated rather than silent: a model that does not know it saw a fragment
    // will answer as though it saw the whole file.
    numbered.push(
      `\n[showing lines ${start + 1}-${shown} of ${lines.length}; read again with offset ${shown + 1} for more]`,
    );
  }

  return numbered.join("\n");
}

export function createReadTool(log: FileAccessLog): ToolDefinition<ReadInput, string> {
  return defineStudioTool({
    descriptor: READ_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.path !== "string" || value.path.trim() === "") {
        throw new ToolError("invalid_input", { message: "path is required." });
      }
      return {
        path: value.path,
        offset: positiveInteger(value.offset, "offset", 1),
        limit: positiveInteger(value.limit, "limit", DEFAULT_LINE_LIMIT),
      };
    },

    resource: (input, context) => context.sandbox.resolveRead(input.path),

    execute: async (input, context) => {
      const absolute = context.sandbox.resolveRead(input.path);
      const stat = await context.sandbox.stat(input.path);

      if (stat.isDirectory) {
        throw new ToolError("invalid_input", {
          message: "That path is a directory. Use glob to list its contents.",
        });
      }

      if (stat.size > MAX_FILE_BYTES) {
        throw new ToolError("invalid_input", {
          message: `This file is ${Math.round(stat.size / 1024)} KB, which is too large to read at once. Search it instead.`,
        });
      }

      const content = await context.sandbox.readFile(input.path);

      if (content.includes("\0")) {
        // Returning binary as text produces plausible-looking nonsense, which
        // is worse than refusing: the model reasons about it as if it were real.
        throw new ToolError("invalid_input", {
          message: "This file is not text and cannot be read.",
        });
      }

      // Recorded against the resolved path, so a later edit naming the same
      // file differently still counts as having read it.
      log.record(context.scope, absolute, {
        modifiedAt: stat.modifiedAt,
      });

      return formatNumbered(content, input.offset, input.limit);
    },
  });
}
