import { isInsideRoot } from "../../sandbox/paths.js";
import { SandboxError } from "../../sandbox/errors.js";
import { conversationTrashDirectory } from "../../platform/paths.js";
import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import type { FileAccessLog } from "./access-log.js";
import { moveToTrash } from "./trash.js";
import { currentState } from "./write.js";

/**
 * Removing a file, or a directory whole.
 *
 * Recovery is chosen by where the deleted path lives, and by nothing else.
 * Inside the workspace root the snapshot history already covers it: the gate
 * takes the restore point before this tool runs, and the shadow repository's
 * next capture records that the file is gone, so a later restore brings it
 * back. Outside that root - a folder the user granted, the conversation's own
 * scratch - no shadow repository watches, so there is nothing to recover
 * from unless the tool itself provides it: the delete moves the path into the
 * conversation's trash and names where.
 *
 * The two answers are mutually exclusive by construction - the trash lives
 * outside every workspace root, the snapshot history covers exactly one -
 * so no deleted path is covered by both, and the result can say which
 * recovery applies without hedging.
 */

export interface DeleteInput {
  readonly path: string;
  readonly recursive: boolean;
}

const DELETE_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "delete" },
  title: "Delete file",
  description:
    "Removes a file, or a directory with everything inside it. Read a file before deleting it. Directories need recursive: true.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      recursive: { type: "boolean" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  effects: ["write"],
  provenance: NATIVE_PROVENANCE,
  // Deleting twice: the second call is told the path is already gone. That is
  // a correct refusal, not a safe retry - the same reasoning as `edit`.
  idempotent: false,
};

export function createDeleteTool(log: FileAccessLog): ToolDefinition<DeleteInput, string> {
  return defineStudioTool({
    descriptor: DELETE_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.path !== "string" || value.path.trim() === "") {
        throw new ToolError("invalid_input", { message: "path is required." });
      }
      if (value.recursive !== undefined && typeof value.recursive !== "boolean") {
        throw new ToolError("invalid_input", {
          message: "recursive must be true or false.",
        });
      }
      return { path: value.path, recursive: value.recursive === true };
    },

    resource: (input, context) => context.sandbox.resolveWrite(input.path),

    // One writer per deleted path, from the staleness check through to the
    // record - the same critical section the other modifying tools hold. A
    // delete racing an edit on one file would otherwise report both as
    // applying while one of them lost the race.
    execute: async (input, context) =>
      log.serialize(context.sandbox.resolveWrite(input.path), async () => {
        const absolute = context.sandbox.resolveWrite(input.path);
        const state = await currentState(context, input.path);
        let trashed: string | undefined;

        if (!state.exists) {
          throw new ToolError("invalid_input", {
            message: "That path does not exist, so there is nothing to delete.",
          });
        }

        if (state.isDirectory && !input.recursive) {
          throw new ToolError("invalid_input", {
            message:
              "That path is a directory. Add recursive: true to delete it and everything inside it.",
          });
        }

        // A file this conversation has not read: the read-before-modify rule,
        // which `write` states and `edit` enforces, applies to a delete as
        // well - a model that has not seen a file does not know what it is
        // discarding. A directory cannot be read (`read` refuses one), so the
        // rule cannot apply to it; there the destruction is made explicit by
        // `recursive` instead, which is the check that can be enforced.
        if (!state.isDirectory) {
          log.assertSafeToModify(context.scope, absolute, state);
        }

        // Which recovery applies is decided by the path: inside the workspace
        // root, the snapshot history; outside it, the trash. `isInsideRoot` is
        // the containment predicate the sandbox itself enforces, so the
        // boundary this message reports and the boundary the shadow
        // repository's history actually covers cannot disagree.
        const insideWorkspace = isInsideRoot(context.sandbox.policy.workspaceRoot, absolute);

        if (insideWorkspace) {
          try {
            await context.sandbox.remove(input.path);
          } catch (error) {
            // Classified sandbox failures pass through, the way they do in
            // `write` and `edit`; anything else is this tool's execution
            // failure, reported as such rather than as a crash.
            if (error instanceof SandboxError) throw error;
            throw new ToolError("execution_failed", {
              message: "The file could not be deleted.",
              cause: error,
            });
          }
        } else {
          const entry = await moveToTrash(
            absolute,
            conversationTrashDirectory(context.scope.conversationId),
            {
              originalPath: absolute,
              deletedAt: Date.now(),
              conversationId: context.scope.conversationId,
            },
          );
          trashed = entry.path;
        }

        // Absence, recorded where the file's state used to be. A file that
        // appears later at the same path - the user's doing, or another
        // conversation's - then counts as changed, and the next modification
        // of it reads before it writes instead of trusting this
        // conversation's memory of a file that is not there.
        log.record(context.scope, absolute, { modifiedAt: 0, size: 0 });

        const recovery = insideWorkspace
          ? "This can be undone: the state before this turn is kept in this project's snapshot history."
          : // The entry path is what a person (or a later conversation) needs
            // to find the payload; this sentence is the only pointer that
            // exists, because nothing grants the trash to the model.
            `This can be undone: it was moved to the trash at ${trashed}, its original name and location recorded in origin.json beside it.`;

        return `Deleted ${input.path}. ${recovery}`;
      }),
  });
}
