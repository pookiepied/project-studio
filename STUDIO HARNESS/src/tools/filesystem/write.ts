import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { SandboxError } from "../../sandbox/errors.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { hashContent, type FileAccessLog } from "./access-log.js";

/**
 * Creating a file, or replacing one whole.
 *
 * Replacing an existing file is the most destructive thing a filesystem tool
 * does, so it is the one with a precondition: the conversation must have read
 * the file first. A model that has not read a file does not know what it is
 * discarding.
 */

export interface WriteInput {
  readonly path: string;
  readonly content: string;
}

export const WRITE_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "write" },
  title: "Write file",
  description:
    "Writes a file, creating it or replacing it entirely. Read an existing file before replacing it. Prefer edit for changing part of a file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      content: { type: "string" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  effects: ["write"],
  provenance: NATIVE_PROVENANCE,
  // Writing the same content twice lands the same file, so a retry after an
  // unknown outcome is safe.
  idempotent: true,
};

/**
 * Reads the current state of the target, treating "outside the sandbox" as a
 * refusal rather than as absence.
 */
export async function currentState(
  context: {
    sandbox: {
      exists: (path: string) => Promise<boolean>;
      stat: (path: string) => Promise<{ modifiedAt: number; size: number; isDirectory: boolean }>;
    };
  },
  path: string,
): Promise<{ exists: boolean; modifiedAt: number; size: number; isDirectory: boolean }> {
  const exists = await context.sandbox.exists(path);
  if (!exists) return { exists: false, modifiedAt: 0, size: 0, isDirectory: false };

  const stat = await context.sandbox.stat(path);
  return {
    exists: true,
    modifiedAt: stat.modifiedAt,
    size: stat.size,
    isDirectory: stat.isDirectory,
  };
}

export function createWriteTool(log: FileAccessLog): ToolDefinition<WriteInput, string> {
  return defineStudioTool({
    descriptor: WRITE_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.path !== "string" || value.path.trim() === "") {
        throw new ToolError("invalid_input", { message: "path is required." });
      }
      if (typeof value.content !== "string") {
        throw new ToolError("invalid_input", {
          message: "content is required, and must be text.",
        });
      }
      return { path: value.path, content: value.content };
    },

    // The *write* roots, not the read roots. A project mounted read-only must
    // fail here rather than at the last moment inside the tool.
    resource: (input, context) => context.sandbox.resolveWrite(input.path),

    // Everything from the staleness check to the record that follows the write
    // is one critical section per file. Two writes to one path that interleave
    // here both pass the same check and the later one silently discards the
    // earlier, which the log would then describe as both having landed.
    execute: async (input, context) =>
      log.serialize(context.sandbox.resolveWrite(input.path), async () => {
        const absolute = context.sandbox.resolveWrite(input.path);
        const state = await currentState(context, input.path);

        if (state.isDirectory) {
          throw new ToolError("invalid_input", {
            message: "That path is a directory.",
          });
        }

        log.assertSafeToModify(context.scope, absolute, state);

        try {
          await context.sandbox.writeFile(input.path, input.content);
        } catch (error) {
          if (error instanceof SandboxError || error instanceof ToolError) throw error;
          throw new ToolError("execution_failed", {
            message: "The file could not be written.",
            cause: error,
          });
        }

        // The file the model just wrote is a file it knows the contents of, so
        // a following edit does not have to re-read it - and the content is in
        // hand here, so the hash costs nothing.
        const written = await context.sandbox.stat(input.path);
        log.record(context.scope, absolute, {
          modifiedAt: written.modifiedAt,
          size: written.size,
          contentHash: hashContent(input.content),
        });

        return state.exists ? `Replaced ${input.path}` : `Created ${input.path}`;
      }),
  });
}
