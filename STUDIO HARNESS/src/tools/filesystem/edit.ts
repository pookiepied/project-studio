import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { hashContent, type FileAccessLog } from "./access-log.js";
import { formatNumbered } from "./read.js";
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
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      oldString: { type: "string", minLength: 1 },
      newString: { type: "string" },
      replaceAll: { type: "boolean" },
    },
    required: ["path", "oldString", "newString"],
    additionalProperties: false,
  },
  effects: ["write"],
  provenance: NATIVE_PROVENANCE,
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

/**
 * Matching a file that uses Windows line endings against text the model typed.
 *
 * `read` shows a file's lines without their carriage returns - it splits on
 * `/\r?\n/` - so a model copying two lines out of a read and back into
 * `oldString` sends `\n` where the file holds `\r\n`. The match then finds
 * nothing, the model is told to "match it exactly, including whitespace", and
 * it retries the same string, because from where it is sitting the string it
 * sent *is* what it was shown. On a product whose first platform is Windows
 * that is not an edge case, it is most multi-line edits.
 *
 * So the file's own convention decides. A file that uses CRLF is matched with
 * a CRLF-converted needle, and the replacement is converted with it, which
 * also stops an edit from quietly leaving one LF-only line in a CRLF file. A
 * needle that already carries `\r` is left exactly as the model wrote it: it
 * may be matching a mixed-ending region deliberately, and rewriting a string
 * that was already right is how a helpful conversion becomes a bug.
 */
function usesCarriageReturns(content: string): boolean {
  const newlines = content.split("\n").length - 1;
  if (newlines === 0) return false;
  const carriageReturns = content.split("\r\n").length - 1;
  // Not "any", because one stray CRLF in an LF file must not convert the rest.
  return carriageReturns * 2 >= newlines;
}

function toCarriageReturns(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

/**
 * Showing the model what its edit produced, instead of making it read the file
 * back.
 *
 * `Edited path` is true and useless. An edit is a blind write - the model
 * composed `newString` against text it remembers, and the one thing it cannot
 * see is how that text sits in the file now: whether the indentation matches
 * its neighbours, whether the brace it closed was the one it meant, whether a
 * CRLF conversion moved anything. So every edit was followed by a read of the
 * same file, which is a second call, the whole file's worth of tokens, and a
 * round trip, to learn something the edit already had in hand.
 *
 * The changed region is what it had in hand. Three lines of context on each
 * side is enough to see the seam and not enough to be a file dump.
 */
const CONTEXT_LINES = 3;

/**
 * At most this many regions are shown for a `replaceAll`.
 *
 * A rename across forty call sites is a legitimate edit and forty excerpts is
 * a wall. Past this the count is the answer, and the model can read the file
 * if it wants the rest.
 */
const MAX_REGIONS = 3;

/**
 * A ceiling on the whole excerpt, in lines.
 *
 * `MAX_REGIONS` alone does not bound it. Changes spaced closer than twice the
 * context merge into one region by design - printing a line twice is worse
 * than merging - and thirty changes seven lines apart merge into a single
 * region covering the file. That is one region, under the cap, and still the
 * dump this is meant not to be. So the budget is counted in lines, and past
 * it the count is the answer.
 */
const MAX_REPORT_LINES = 40;

/** A window of the updated file, as 1-based inclusive line numbers. */
interface ChangedRegion {
  readonly from: number;
  readonly to: number;
}

/** The 1-based line a character index falls on. */
function lineOfIndex(content: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index && at < content.length; at += 1) {
    if (content[at] === "\n") line += 1;
  }
  return line;
}

function lineCount(content: string): number {
  const lines = content.split(/\r?\n/);
  // A trailing newline produces a final empty element that is not a line, the
  // same way `formatNumbered` counts them - the two must agree or a region
  // will be clamped to a line the reader will not print.
  if (lines.at(-1) === "") lines.pop();
  return Math.max(lines.length, 1);
}

/**
 * Where the replacements landed in the updated content.
 *
 * Positions are derived rather than searched for. Searching the updated file
 * for `newString` finds occurrences that were already there before the edit,
 * which would report untouched text as changed. Each match's position in the
 * original is known, and every earlier replacement shifted what follows it by
 * a fixed amount, so the arithmetic is exact.
 */
function changedRegions(
  original: string,
  updated: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): readonly ChangedRegion[] {
  const drift = newString.length - oldString.length;
  const total = lineCount(updated);
  const regions: ChangedRegion[] = [];

  let index = original.indexOf(oldString);
  let replaced = 0;
  while (index !== -1) {
    const start = index + replaced * drift;
    // `newString` may be empty - a deletion - and then the region is the one
    // line the removed text used to start on, which is the seam worth seeing.
    const end = start + Math.max(newString.length - 1, 0);

    const from = Math.max(lineOfIndex(updated, start) - CONTEXT_LINES, 1);
    const to = Math.min(lineOfIndex(updated, end) + CONTEXT_LINES, total);

    const previous = regions.at(-1);
    if (previous !== undefined && from <= previous.to + 1) {
      // Two edits close enough that their context windows touch are one
      // excerpt, not two overlapping ones that print the same lines twice.
      regions[regions.length - 1] = { from: previous.from, to: Math.max(previous.to, to) };
    } else {
      regions.push({ from, to });
    }

    replaced += 1;
    if (!replaceAll) break;
    index = original.indexOf(oldString, index + oldString.length);
  }

  return regions;
}

/** The excerpt the model is shown, or undefined when there is nothing to show. */
function changedRegionReport(regions: readonly ChangedRegion[], updated: string): string | undefined {
  if (regions.length === 0) return undefined;

  const shown = regions.slice(0, MAX_REGIONS);
  const lines = shown.reduce((total, region) => total + (region.to - region.from + 1), 0);
  if (lines > MAX_REPORT_LINES) {
    return `[the changed lines span more than ${MAX_REPORT_LINES} lines; read the file to see them]`;
  }

  const excerpts = shown.map((region) =>
    // Paging off: this is a bounded excerpt of a file the model is not being
    // invited to page through, and the read tool's footer would describe it as
    // a truncated file.
    formatNumbered(updated, region.from, region.to - region.from + 1, { paging: false }),
  );

  if (regions.length > shown.length) {
    excerpts.push(`[${regions.length - shown.length} more changed regions not shown]`);
  }
  return excerpts.join("\n\n");
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

    // One writer per file, from the staleness check through to the record.
    // See `PathLocks`: the read-modify-write below spans several awaits, and
    // two edits interleaving inside it lose one of the two changes while
    // reporting both as applied.
    execute: async (input, context) =>
      log.serialize(context.sandbox.resolveWrite(input.path), async () => {
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

        // Read before the staleness check rather than after it, because the
        // content is the evidence: an edit reads the whole file anyway, so the
        // hash comparison costs nothing here and catches what a timestamp
        // cannot - a rewrite inside one filesystem tick, or a writer that put
        // the timestamp back.
        const content = await context.sandbox.readFile(input.path);
        log.assertSafeToModify(context.scope, absolute, {
          ...state,
          contentHash: hashContent(content),
        });

        const crlf = usesCarriageReturns(content) && !input.oldString.includes("\r");
        const oldString = crlf ? toCarriageReturns(input.oldString) : input.oldString;
        const newString = crlf ? toCarriageReturns(input.newString) : input.newString;

        const occurrences = countOccurrences(content, oldString);

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
          ? content.replaceAll(oldString, literal(newString))
          : content.replace(oldString, literal(newString));

        await context.sandbox.writeFile(input.path, updated);

        const after = await context.sandbox.stat(input.path);
        log.record(context.scope, absolute, {
          modifiedAt: after.modifiedAt,
          size: after.size,
          contentHash: hashContent(updated),
        });

        const headline =
          occurrences === 1
            ? `Edited ${input.path}`
            : `Edited ${input.path} (${occurrences} occurrences)`;

        const excerpt = changedRegionReport(
          changedRegions(content, updated, oldString, newString, input.replaceAll),
          updated,
        );
        return excerpt === undefined ? headline : `${headline}\n\n${excerpt}`;
      }),
  });
}
