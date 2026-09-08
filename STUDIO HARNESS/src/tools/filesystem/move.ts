import { isInsideRoot } from "../../sandbox/paths.js";
import { SandboxError } from "../../sandbox/errors.js";
import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { pathKey, type FileAccessLog } from "./access-log.js";
import { currentState, directoriesToCreate } from "./write.js";

/**
 * Renaming a file, or relocating it. Nothing else in the tool set expresses
 * this: `edit` changes what a file contains, `write` creates one, and the
 * shell writes files without any of the checks the filesystem family exists
 * for - which is why it is the fallback and not the habit.
 *
 * A move loses nothing, so it carries no read-before-modify precondition.
 * What it can destroy is the *destination*, and only when the caller asked
 * for the overwrite: there the read-first rule applies, because replacing a
 * file whose contents the conversation never saw is the blind overwrite
 * `write`'s own precondition exists to prevent.
 */

export interface MoveInput {
  readonly from: string;
  readonly to: string;
  readonly overwrite: boolean;
}

export const MOVE_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "move" },
  title: "Move or rename",
  description:
    "Renames a file or directory, or moves it to another of this agent's roots. Neither path may be the workspace root; a destination that already exists is replaced only when overwrite is true.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", minLength: 1 },
      to: { type: "string", minLength: 1 },
      overwrite: { type: "boolean" },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  effects: ["write"],
  provenance: NATIVE_PROVENANCE,
  // A retried move is told the source is already gone. A correct refusal, not
  // a safe retry - the same reasoning as `edit`.
  idempotent: false,
};

export function createMoveTool(log: FileAccessLog): ToolDefinition<MoveInput, string> {
  return defineStudioTool({
    descriptor: MOVE_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.from !== "string" || value.from.trim() === "") {
        throw new ToolError("invalid_input", { message: "from is required." });
      }
      if (typeof value.to !== "string" || value.to.trim() === "") {
        throw new ToolError("invalid_input", { message: "to is required." });
      }
      if (value.overwrite !== undefined && typeof value.overwrite !== "boolean") {
        throw new ToolError("invalid_input", {
          message: "overwrite must be true or false.",
        });
      }
      return {
        from: value.from,
        to: value.to,
        overwrite: value.overwrite === true,
      };
    },

    // A move touches two places: it takes from one and lands in another, so
    // both are named and both are authorized. `resource` stays the source,
    // which is also what the gate hands the snapshot - the state being
    // captured is the project before either endpoint changed.
    resource: (input, context) => context.sandbox.resolveWrite(input.from),
    resources: (input, context) => [
      context.sandbox.resolveWrite(input.from),
      context.sandbox.resolveWrite(input.to),
    ],

    // Serialized by the destination, which is the only endpoint whose state
    // this call checks and then changes: existence, and - under overwrite -
    // whether what is there was read. Two moves landing on one destination
    // therefore decide their clobber checks in order instead of both
    // deciding "empty" and the second silently discarding the first. The
    // source is left to its own devices: its one hazard, disappearing while
    // another call moves it too, surfaces as a failed second rename, which
    // is a refused call rather than a lost one.
    execute: async (input, context) =>
      log.serialize(context.sandbox.resolveWrite(input.to), async () => {
        const source = context.sandbox.resolveWrite(input.from);
        const destination = context.sandbox.resolveWrite(input.to);

        const before = await currentState(context, input.from);
        if (!before.exists) {
          throw new ToolError("invalid_input", {
            message: "The source does not exist, so there is nothing to move.",
          });
        }

        if (pathKey(source) === pathKey(destination)) {
          throw new ToolError("invalid_input", {
            message: "The source and the destination are the same path, so this moves nothing.",
          });
        }

        if (before.isDirectory && isInsideRoot(source, destination)) {
          throw new ToolError("invalid_input", {
            message: "A directory cannot be moved inside itself.",
          });
        }

        // Asked before the removal, while the answer still exists: what this
        // move creates on the way. See `directoriesToCreate` in `write` - the
        // same silent parents, owed the same report.
        const created = await directoriesToCreate(context.sandbox, input.to);

        const after = await currentState(context, input.to);
        if (after.exists) {
          if (!input.overwrite) {
            throw new ToolError("invalid_input", {
              message:
                "The destination already exists. Add overwrite: true to replace it, or choose another name.",
            });
          }
          if (after.isDirectory) {
            // Replacing a directory wholesale is `delete`'s work with
            // `recursive`; collapsing both into one overwrite would make the
            // destructive call the one nobody's expectations survive.
            throw new ToolError("invalid_input", {
              message:
                "The destination is a directory. Delete it first, or move to a path nothing occupies.",
            });
          }
          // The read-first rule, at the only place a move discards anything.
          log.assertSafeToModify(context.scope, destination, after);
        }

        // The two physical mutations, together: the replaced destination's
        // removal and the rename. One classified sandbox failure passes
        // through; anything else is this tool's execution failure, reported
        // as such rather than as a crash.
        try {
          if (after.exists) await context.sandbox.remove(input.to);
          await context.sandbox.rename(input.from, input.to);
        } catch (error) {
          if (error instanceof SandboxError) throw error;
          throw new ToolError("execution_failed", {
            message: "The file could not be moved.",
            cause: error,
          });
        }

        // The old path is recorded as absent, exactly as `delete` records
        // it: a file that appears there later counts as changed, and the
        // conversation reads before it trusts. The destination is
        // deliberately *not* recorded - this conversation has never seen
        // what it contains, and the log only ever speaks for what was seen.
        log.record(context.scope, source, { modifiedAt: 0, size: 0 });

        const headline = `Moved ${input.from} to ${input.to}.`;
        const createdNote =
          created.length === 0
            ? undefined
            : `Created ${
                created.length === 1 ? "directory" : "directories"
              } ${created.join(", ")}, which did not exist.`;
        // Both endpoints inside the workspace root: the snapshot history
        // holds the state of both, and restoring it undoes the move. Once
        // either endpoint lies outside, nothing recorded the state, and the
        // honest answer is the cheap one: nothing was lost, so moving it
        // back undoes this.
        const insideWorkspace =
          isInsideRoot(context.sandbox.policy.workspaceRoot, source) &&
          isInsideRoot(context.sandbox.policy.workspaceRoot, destination);
        const recoveryNote = insideWorkspace
          ? "This can be undone from this project's snapshot history."
          : "The file's contents are unchanged, and moving it back undoes this.";

        return [headline, createdNote, recoveryNote].filter(Boolean).join(" ");
      }),
  });
}
