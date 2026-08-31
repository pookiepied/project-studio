import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { SandboxFileStat } from "../../sandbox/local-sandbox.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { hashContent, type FileAccessLog } from "./access-log.js";

/**
 * Reading a file, the way a model can actually use it.
 *
 * Line numbers are not decoration: they are how the model refers to a location
 * afterwards, and how a person checks that a proposed edit points where it
 * claims. The limits exist because a file large enough to fill the context
 * window costs the conversation more than it returns.
 *
 * Since Task 46, a picture is also a reading: an image comes back as an
 * attachment riding the same content blocks an MCP server's image already
 * rides, so a model that can see one can look at what the project actually
 * looks like instead of being told it is binary. The model's own catalog
 * decides whether that is offered - a model marked unable to take image input
 * gets a sentence rather than a wall of base64.
 */

/** A window, not a whole file. The model asks again for more. */
const DEFAULT_LINE_LIMIT = 2_000;

/** Beyond this a "line" is machine output, not something to reason about. */
const MAX_LINE_LENGTH = 2_000;

/** 1 MiB. A larger file is a data file, and belongs to a search, not a read. */
const MAX_FILE_BYTES = 1024 * 1024;

/** Image kinds that can ride an image content block, by extension. */
const IMAGE_MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

export interface ReadInput {
  readonly path: string;
  /** 1-based first line to return. */
  readonly offset: number;
  readonly limit: number;
}

/**
 * One content block of a read result. Text for a text file; text plus an
 * image for a picture. The shapes mirror what the agent loop accepts -
 * structurally, for the same reason `studio-runtime.ts` mirrors them there.
 */
export type ReadContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export type ReadOutput =
  | string
  | { readonly content: readonly ReadContentBlock[] };

export interface ReadToolOptions {
  /**
   * Whether the calling conversation's model accepts image input, or undefined
   * when that is not known. Only the catalog's explicit "unsupported" refuses;
   * unknown is not evidence of blindness, and refusing on it would lock every
   * user-declared endpoint out of the feature.
   */
  readonly acceptsImages?: (conversationId: string) => boolean | undefined;
}

export const READ_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "read" },
  title: "Read file",
  description:
    "Reads a file from the project, returning numbered lines. Use offset and limit to page through a long file. " +
    "Images (PNG, JPEG, GIF, WebP) come back as attachments when the model accepts image input.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  effects: ["read"],
  provenance: NATIVE_PROVENANCE,
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

  if (window.length === 0) {
    // An offset past the end used to return the empty string, which the model
    // cannot tell apart from an empty file or a failed read - so it answers as
    // though the file held nothing. Say which of the three this is.
    return `(no lines at offset ${offset} - this file has ${lines.length} ${
      lines.length === 1 ? "line" : "lines"
    })`;
  }

  const numbered = window.map((line, index) => {
    const number = String(start + index + 1).padStart(6, " ");
    const text =
      line.length > MAX_LINE_LENGTH
        ? `${line.slice(0, MAX_LINE_LENGTH)}... [line truncated]`
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

/**
 * Bounded edit distance, giving up once the answer passes `limit`.
 *
 * The bound is what keeps this cheap: the candidate list is one directory's
 * names, and anything further than a typo away is not a near miss.
 */
function editDistanceWithin(a: string, b: string, limit: number): number | undefined {
  if (Math.abs(a.length - b.length) > limit) return undefined;

  let previous: number[] = [];
  for (let index = 0; index <= b.length; index += 1) previous.push(index);

  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      const value = Math.min(
        (previous[column] as number) + 1,
        (current[column - 1] as number) + 1,
        (previous[column - 1] as number) + cost,
      );
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return undefined;
    previous = current;
  }
  const distance = previous[b.length];
  return (distance as number) <= limit ? (distance as number) : undefined;
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

/**
 * Siblings of a wrong path, cheapest first: the parent directory, no recursion.
 *
 * A missing file is the most common failure a read has, and the name usually
 * differs by a case, an extension, or a typo. Substring matches in either
 * direction catch the first two; a bounded edit distance on the whole name and
 * on the extension-stripped stem catches the third. Order is exact-or-substring
 * first, then by distance, because the closest name should be the first one the
 * model retries.
 */
export function suggestNearMisses(
  base: string,
  entries: readonly string[],
): readonly string[] {
  const lowered = base.toLowerCase();
  const loweredStem = stem(lowered);

  const scored: { readonly entry: string; readonly rank: number }[] = [];
  for (const entry of entries) {
    const candidate = entry.toLowerCase();
    const candidateStem = stem(candidate);

    let rank: number | undefined;
    if (
      lowered === candidate ||
      lowered.includes(candidate) ||
      candidate.includes(lowered) ||
      // A dotfile's stem is empty, and includes("") is always true - so the
      // stem comparison is gated on both stems meaning something.
      (loweredStem !== "" &&
        candidateStem !== "" &&
        (candidateStem.includes(loweredStem) || loweredStem.includes(candidateStem)))
    ) {
      rank = 0;
    } else {
      const distance = editDistanceWithin(lowered, candidate, 2) ??
        editDistanceWithin(loweredStem, candidateStem, 2);
      rank = distance === undefined ? undefined : distance + 1;
    }
    if (rank !== undefined && entry.toLowerCase() !== lowered) {
      scored.push({ entry, rank });
    }
  }

  return scored
    .sort((a, b) => a.rank - b.rank || a.entry.localeCompare(b.entry))
    .slice(0, 3)
    .map((match) => match.entry);
}

function missingFileError(path: string, siblings: readonly string[]): ToolError {
  if (siblings.length === 0) {
    return new ToolError("invalid_input", {
      message: `There is no file at ${path}.`,
    });
  }
  const suggestions = siblings.map((entry) => `- ${entry}`).join("\n");
  return new ToolError("invalid_input", {
    message: `There is no file at ${path}. Did you mean one of these, in the same directory?\n${suggestions}`,
  });
}

export function createReadTool(
  log: FileAccessLog,
  options: ReadToolOptions = {},
): ToolDefinition<ReadInput, ReadOutput> {
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

      let stat: SandboxFileStat;
      try {
        stat = await context.sandbox.stat(input.path);
      } catch (error) {
        if (error instanceof ToolError) throw error;
        // Outside the sandbox is refused, and the refusal carries nothing
        // about what is there - a probe is answered the same way whether the
        // path exists or not. A path inside that does not exist is the common
        // case, and it gets the near misses that turn a dead end into a
        // retry.
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          let siblings: readonly string[] = [];
          try {
            siblings = await context.sandbox.readdir(dirname(absolute));
          } catch {
            // No directory to look in - the plain refusal still says where
            // the path was expected.
          }
          throw missingFileError(input.path, suggestNearMisses(basename(input.path), siblings));
        }
        throw error;
      }

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

      const extension = extensionOf(input.path);
      const mimeType = IMAGE_MIME_BY_EXTENSION.get(extension);

      if (extension === ".pdf") {
        // Nothing downstream can carry one: the agent loop forwards text and
        // image blocks and nothing else, and Pi's catalog marks image input
        // only, so there is no honest answer to "can this model read a PDF".
        // A refusal that says so beats base64 dressed up as an image.
        throw new ToolError("invalid_input", {
          message:
            "This file is a PDF, and PDFs cannot be shown to the model yet. " +
            "Extract the text you need with a command instead.",
        });
      }

      if (mimeType !== undefined) {
        const acceptsImages = options.acceptsImages?.(context.scope.conversationId);
        if (acceptsImages === false) {
          throw new ToolError("invalid_input", {
            message:
              `${input.path} is an image, and the current model does not accept ` +
              "image input, so it cannot be shown here. The user can switch to a " +
              "model that accepts images, or describe what the picture contains " +
              "and ask again.",
          });
        }

        // Through the sandbox for the path, then bytes straight from disk: the
        // sandbox reads text, and re-decoding a picture as utf8 to encode it
        // again would corrupt it. The path was contained by `resolveRead`
        // above, the same seam `sessionEnvironment.readFileBuffer` uses.
        const bytes = await readFile(absolute);

        // Recorded against the resolved path like any other read, so the
        // access log stays the one answer to "what has this agent looked at".
        log.record(context.scope, absolute, {
          modifiedAt: stat.modifiedAt,
          size: stat.size,
          contentHash: hashContent(bytes),
        });

        return {
          content: [
            { type: "text", text: `Attached: ${input.path} (${mimeType}).` },
            { type: "image", data: bytes.toString("base64"), mimeType },
          ],
        };
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
      // file differently still counts as having read it. The hash is the
      // content just read, so a later edit can compare bytes rather than
      // trusting a timestamp.
      log.record(context.scope, absolute, {
        modifiedAt: stat.modifiedAt,
        size: stat.size,
        contentHash: hashContent(content),
      });

      return formatNumbered(content, input.offset, input.limit);
    },
  });
}

function extensionOf(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}
