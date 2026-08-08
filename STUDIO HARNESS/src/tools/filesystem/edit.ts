import type { CapabilityDescriptor } from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import type { FileAccessLog } from "./access-log.js";
import { currentState } from "./write.js";

/**
 * Changing part of a file by exact string replacement.
 *
 * Not by line number, and not by diff. Line numbers go stale the moment
 * anything above them changes, and a diff the model composed is a diff nobody
 * verified. An exact string either occurs in the file or it does not, so a
 * mistaken edit fails loudly instead of landing somewhere unintended.
 *
 * The uniqueness rule is the other half: if the text appears three times, the
 * model has not said which one it meant, and picking the first is a guess with
 * a one-in-three chance of being right.
 */

export interface EditInput {
  readonly path: string;
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll: boolean;
}

export const EDIT_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "edit" },
  title: "Edit file",
  description:
    "Replaces an exact string in a file. The string must appear exactly once unless replaceAll is set. Read the file first.",
  effects: ["write"],
  provenance: { origin: "native", sourceId: "project-studio", trusted: true },
  // Applying the same edit twice fails the second time, because the old string
  // is gone. That is a correct refusal, not a safe retry.
  idempotent: false,
};

/**
 * Inserts the replacement exactly as written.
 *
 * `String.replace` treats the *replacement* as a pattern even when the thing
 * being searched for is a plain string, so `$&`, `` $` ``, `$'`, `$$`, `$1`, and
 * `$<name>` are substituted rather than inserted. That is a rule about regular
 * expressions leaking into a call that involves no regular expression at all.
 *
 * The text here is whatever the model wants to put in a file, and `$` is
 * ordinary content — shell variables, regex source, CSS, a `sed` example, any
 * documentation of a capture group. Interpreting it wrote something other than
 * what was asked for and reported success, which is the failure this tool's
 * whole design is meant to make impossible.
 *
 * A replacer function is the fix rather than escaping `$` as `$$`: escaping is
 * a transformation that has to be correct, and a function is specified to
 * insert its return value verbatim.
 */
function literal(replacement: string): () => string {
  return () => replacement;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function createEditTool(log: FileAccessLog): ToolDefinition<EditInput, string> {
  return defineStudioTool({
    descriptor: EDIT_DESCRIPTOR,
    resourceKind: "path",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.path !== "string" || value.path.trim() === "") {
        throw new ToolError("invalid_input", { message: "path is required." });
      }
      if (typeof value.oldString !== "string" || value.oldString === "") {
        throw new ToolError("invalid_input", {
          message: "oldString is required and cannot be empty.",
        });
      }
      if (typeof value.newString !== "string") {
        throw new ToolError("invalid_input", {
          message: "newString is required, and must be text.",
        });
      }
      if (value.oldString === value.newString) {
        throw new ToolError("invalid_input", {
          message: "oldString and newString are identical, so this edit would change nothing.",
        });
      }
      if (value.replaceAll !== undefined && typeof value.replaceAll !== "boolean") {
        throw new ToolError("invalid_input", {
          message: "replaceAll must be true or false.",
        });
      }

      return {
        path: value.path,
        oldString: value.oldString,
        newString: value.newString,
        replaceAll: value.replaceAll === true,
      };
    },

    resource: (input, context) => context.sandbox.resolveWrite(input.path),

    execute: async (input, context) => {
      const absolute = context.sandbox.resolveWrite(input.path);
      const state = await currentState(context, input.path);

      if (!state.exists) {
        throw new ToolError("invalid_input", {
          message: "That file does not exist. Use write to create it.",
        });
      }
      if (state.isDirectory) {
        throw new ToolError("invalid_input", { message: "That path is a directory." });
      }

      log.assertSafeToModify(context.scope, absolute, state);

      const content = await context.sandbox.readFile(input.path);
      const occurrences = countOccurrences(content, input.oldString);

      if (occurrences === 0) {
        throw new ToolError("invalid_input", {
          message:
            "That exact text was not found in the file. Read the file again and match it exactly, including whitespace.",
        });
      }

      if (occurrences > 1 && !input.replaceAll) {
        throw new ToolError("invalid_input", {
          message: `That text appears ${occurrences} times. Include more surrounding text to identify one, or set replaceAll to change every occurrence.`,
        });
      }

      const updated = input.replaceAll
        ? content.replaceAll(input.oldString, literal(input.newString))
        : content.replace(input.oldString, literal(input.newString));

      await context.sandbox.writeFile(input.path, updated);

      const after = await context.sandbox.stat(input.path);
      log.record(context.scope, absolute, {
        modifiedAt: after.modifiedAt,
        existed: true,
      });

      return occurrences === 1
        ? `Edited ${input.path}`
        : `Edited ${input.path} (${occurrences} occurrences)`;
    },
  });
}
