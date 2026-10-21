import { open, readFile, type FileHandle } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import type { SandboxFileStat } from "../../sandbox/local-sandbox.js";
import { ToolError } from "../errors.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { hashContent, type FileAccessLog } from "./access-log.js";
import { DocumentError } from "../../documents/errors.js";
import { decodeTextBytes } from "../../documents/text-encoding.js";
import { dimensionsPhrase, imageDimensions } from "../../documents/image-dimensions.js";
import {
  coverageNote,
  documentFormatOf,
  extractDocument,
  pageRanges,
  parsePageRanges,
  renderPages,
} from "../../documents/extract.js";
import { pictureSizeRefusal } from "./picture-size.js";
import { DOCUMENT_MAX_BYTES, TOOL_PICTURE_MAX_BYTES } from "../../contracts/media-limits.js";

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
const MAX_TEXT_BYTES = 1024 * 1024;

/** Every limit a picture is held to lives in `contracts/media-limits.ts`. */

/** Image kinds that can ride an image content block, by extension. */
const IMAGE_MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

/**
 * Image kinds a person plausibly points the tool at, which the model still
 * cannot be shown - the extensions deliberately absent from
 * `IMAGE_MIME_BY_EXTENSION`.
 *
 * Adding them there is the obvious-looking fix and it is wrong: it would turn
 * a bad error message into a failed provider call, which is strictly worse.
 * The providers this serves take PNG, JPEG, GIF and WebP and nothing more -
 * Bedrock's adapter throws on any other mime outright, and Anthropic and
 * OpenAI answer a BMP with a 400. (Google's models also take HEIC and HEIF,
 * but a refusal here runs before the conversation's provider is known, so the
 * message names only the formats every vision-capable model this serves
 * accepts.) An unshowable picture is refused by kind instead, ahead of the
 * size check, with the formats that would have worked named.
 *
 * SVG is absent on purpose: it is text, and reading it as text is right.
 */
const UNSHOWABLE_IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
]);

/** What the kind refusal calls the file. A named format is one the model can act on. */
const UNSHOWABLE_IMAGE_LABELS: ReadonlyMap<string, string> = new Map([
  ["image/bmp", "a BMP image"],
  ["image/tiff", "a TIFF image"],
  ["image/heic", "a HEIC image"],
  ["image/heif", "a HEIF image"],
  ["image/avif", "an AVIF image"],
  ["image/x-icon", "an ICO icon"],
]);

/** Every extension this treats as a picture, showable or not. */
const IMAGE_ISH_EXTENSIONS: ReadonlySet<string> = new Set([
  ...IMAGE_MIME_BY_EXTENSION.keys(),
  ...UNSHOWABLE_IMAGE_EXTENSIONS.keys(),
]);

export interface ReadInput {
  readonly path: string;
  /** 1-based first line to return. */
  readonly offset: number;
  readonly limit: number;
  /** A document's pages to read, as "3-5,9"; documents only. */
  readonly pages?: string;
}

/**
 * One content block of a read result. Text for a text file; text plus an
 * image for a picture. The shapes mirror what the agent loop accepts -
 * structurally, for the same reason `studio-runtime.ts` mirrors them there.
 */
type ReadContentBlock =
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
  // The limits are stated rather than discovered. A model that does not know
  // the default window is 2000 lines reads a 5000-line file, is handed the
  // first 2000, and answers about the file - the footer says a fragment was
  // shown, but only after the answer has already been shaped by it. Saying the
  // numbers up front is what lets a model ask for the right window on the
  // first call instead of the second.
  description:
    "Reads a file from the project, returning numbered lines. Reads the first " +
    "2000 lines by default; use offset and limit to page through a longer " +
    "file. A line longer than 2000 characters is truncated, and a text file " +
    "larger than 1 MB is refused - search it instead. " +
    `Images (PNG, JPEG, GIF, WebP) come back as attachments when the model ` +
    `accepts image input, up to ${String(Math.round(TOOL_PICTURE_MAX_BYTES / 1_000_000))} MB each. Older ` +
    "pictures may later be left out of a request to stay inside provider limits; read the file again to see one. A PDF, Word, PowerPoint or Excel " +
    "file comes back as its text, page after page under [page N] markers, numbered and " +
    "paged like any text file; pass pages as \"3-5,9\" to read only those pages of a " +
    "long one. A note at the top names any pages with no text layer, which the ocr tool " +
    "can read. Grep cannot search inside these files; read them.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
      pages: {
        type: "string",
        minLength: 1,
        description: 'PDF, Word, PowerPoint or Excel only: the pages (slides, sheets) to read, one-based, as "3-5,9".',
      },
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

export interface FormatNumberedOptions {
  /**
   * Whether to append the "read again with offset N" footer.
   *
   * True for a read, where the window is a page of a file the model may want
   * the rest of. False for a caller showing a deliberately bounded excerpt -
   * `edit` reporting the region it changed - where the footer would invite a
   * page-through nobody asked for and describe the excerpt as a truncated
   * file. Defaults to true, so the read tool's behaviour is unchanged by the
   * option existing.
   */
  readonly paging?: boolean;
}

/**
 * Formats content the way `cat -n` does, so a line number in the output means
 * the same thing as a line number in an editor.
 */
export function formatNumbered(
  content: string,
  offset: number,
  limit: number,
  options: FormatNumberedOptions = {},
): string {
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
  if (shown < lines.length && options.paging !== false) {
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
  return (distance as number) <= limit ? (distance) : undefined;
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
function suggestNearMisses(
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

/** The head a sniff needs. The furthest signature read ends at byte 12. */
const SNIFF_HEAD_BYTES = 16;

/**
 * The first bytes of a file, for deciding what it is without reading it all.
 *
 * Straight from disk rather than through the sandbox, which decodes utf8 -
 * the same seam the image read below uses, over a path `resolveRead` has
 * already contained. This is a bounded read, not a whole-file one: the kind
 * is decided before the size checks, and learning that a 58 MB file is a PNG
 * must not mean holding it in memory first. A failure returns undefined
 * rather than erroring: the sniff is a refinement of the extension's
 * decision, and a file whose head cannot be read still deserves the answer
 * the name alone would have given it.
 */
async function readHead(absolute: string, length: number): Promise<Buffer | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolute, "r");
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

const asciiAt = (bytes: Buffer, start: number, length: number): string =>
  bytes.subarray(start, start + length).toString("latin1");

const startsWith = (bytes: Buffer, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

/**
 * What the leading bytes say a file is. Showable rides an image content
 * block; unshowable is a picture the model cannot take, which hears why;
 * undefined means the head matched no signature this knows and the extension
 * decides, as it always has.
 */
type SniffedImageKind =
  | { readonly verdict: "showable"; readonly mimeType: string }
  | { readonly verdict: "unshowable"; readonly mimeType: string };

/** ", WxH px" from the picture's header, with the downscale warning when large. */
function pixelSize(bytes: Uint8Array): string {
  const phrase = dimensionsPhrase(imageDimensions(bytes));
  return phrase === "" ? "" : `, ${phrase}`;
}

function sniffImageKind(head: Buffer, extension: string): SniffedImageKind | undefined {
  // The strong signatures, believed on the bytes alone: a text file does not
  // plausibly begin with any of these.
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { verdict: "showable", mimeType: "image/png" };
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return { verdict: "showable", mimeType: "image/jpeg" };
  }
  if (asciiAt(head, 0, 6) === "GIF87a" || asciiAt(head, 0, 6) === "GIF89a") {
    return { verdict: "showable", mimeType: "image/gif" };
  }
  if (asciiAt(head, 0, 4) === "RIFF" && asciiAt(head, 8, 4) === "WEBP") {
    return { verdict: "showable", mimeType: "image/webp" };
  }
  if (asciiAt(head, 0, 4) === "II*\0" || asciiAt(head, 0, 4) === "MM\0*") {
    return { verdict: "unshowable", mimeType: "image/tiff" };
  }
  if (asciiAt(head, 4, 4) === "ftyp") {
    const brand = asciiAt(head, 8, 4);
    if (brand === "avif" || brand === "avis") {
      return { verdict: "unshowable", mimeType: "image/avif" };
    }
    if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "hevx") {
      return { verdict: "unshowable", mimeType: "image/heic" };
    }
    if (brand === "mif1" || brand === "msf1" || brand === "miaf") {
      return { verdict: "unshowable", mimeType: "image/heif" };
    }
    // A container this does not serve (mp4, mov) is not a picture here;
    // leave it to the extension and, failing that, the binary guard.
    return undefined;
  }
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) {
    return { verdict: "unshowable", mimeType: "image/x-icon" };
  }
  // The one weak signature: two ASCII letters that begin ordinary words.
  // "BMW sales by quarter" is text and must stay text, so a bare "BM" is
  // believed only when the name already claims a picture.
  if (asciiAt(head, 0, 2) === "BM" && IMAGE_ISH_EXTENSIONS.has(extension)) {
    return { verdict: "unshowable", mimeType: "image/bmp" };
  }
  return undefined;
}

async function sniffedImageKind(
  absolute: string,
  extension: string,
): Promise<SniffedImageKind | undefined> {
  const head = await readHead(absolute, SNIFF_HEAD_BYTES);
  if (head === undefined) return undefined;
  return sniffImageKind(head, extension);
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
      if (value.pages !== undefined && (typeof value.pages !== "string" || value.pages.trim() === "")) {
        throw new ToolError("invalid_input", { message: 'pages must be text such as "3-5,9".' });
      }
      return {
        path: value.path,
        offset: positiveInteger(value.offset, "offset", 1),
        limit: positiveInteger(value.limit, "limit", DEFAULT_LINE_LIMIT),
        ...(value.pages === undefined ? {} : { pages: value.pages }),
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

      const extension = extensionOf(input.path);
      const format = documentFormatOf(input.path);

      if (format !== undefined) {
        // A document is read as its text. Nothing downstream can carry the
        // file itself - the agent loop forwards text and image blocks and
        // nothing else - so the honest reading is the words the pages hold,
        // each under its page marker, numbered like any text file and paged
        // the same way. A page with no text layer is not passed off as a
        // blank page: the coverage note in front names it and the tool that
        // reads it. Ahead of the size check, because the text limit was
        // written for source files and a document's bytes are mostly not its
        // text.
        if (stat.size > DOCUMENT_MAX_BYTES) {
          throw new ToolError("invalid_input", {
            message:
              `This document is ${Math.round(stat.size / (1024 * 1024))} MB, which is larger than ` +
              "can be read here. Extract the pages you need with a command instead.",
          });
        }
        const bytes = await readFile(absolute);
        log.record(context.scope, absolute, {
          modifiedAt: stat.modifiedAt,
          size: stat.size,
          contentHash: hashContent(bytes),
        });
        let document;
        try {
          document = await extractDocument(bytes, format);
        } catch (error) {
          if (error instanceof DocumentError) {
            throw new ToolError("invalid_input", { message: error.message });
          }
          throw error;
        }
        let only: readonly number[] | undefined;
        try {
          only = input.pages === undefined ? undefined : parsePageRanges(input.pages, document.pages.length);
        } catch (error) {
          if (error instanceof DocumentError) throw new ToolError("invalid_input", { message: error.message });
          throw error;
        }
        // Said in front, like the coverage note: lines are numbered within
        // what was selected, so the model must know it is not the whole.
        const selection = only === undefined
          ? ""
          : `[${document.unit}s ${pageRanges(only)} of ${String(document.pages.length)}]\n\n`;
        return formatNumbered(
          `${selection}${coverageNote(document, input.path)}${renderPages(document, only)}`,
          input.offset,
          input.limit,
        );
      }
      if (input.pages !== undefined) {
        throw new ToolError("invalid_input", {
          message: "pages applies to PDF, Word, PowerPoint and Excel files. Use offset and limit for this file.",
        });
      }

      // The kind is decided from the bytes first and the name second. Reading
      // a sixteen-byte head costs one small open on a file that is about to
      // be read anyway, and it is what makes a real PNG carrying a .txt name
      // an attachment rather than a "not text" refusal - the mirror of the
      // mislabelled picture that only ever worked because the provider was
      // tolerant of what its name claimed. When the head matches no signature
      // the extension decides, as it always has.
      const sniffed = await sniffedImageKind(absolute, extension);
      const mimeType =
        sniffed === undefined
          ? IMAGE_MIME_BY_EXTENSION.get(extension)
          : sniffed.verdict === "showable"
            ? sniffed.mimeType
            : undefined;
      const unshowableMime =
        sniffed === undefined
          ? UNSHOWABLE_IMAGE_EXTENSIONS.get(extension)
          : sniffed.verdict === "unshowable"
            ? sniffed.mimeType
            : undefined;

      if (unshowableMime !== undefined) {
        // Ahead of the size check, like the PDF branch above: this is refused
        // whatever the file weighs, so a large one should hear why rather than
        // be told to search a bitmap nothing here can search - and a small one
        // should hear why rather than be refused as binary, which is true but
        // teaches nothing. The working formats are named because a refusal
        // that does not say what would have worked cannot be acted on.
        throw new ToolError("invalid_input", {
          message:
            `This file is ${UNSHOWABLE_IMAGE_LABELS.get(unshowableMime)}, which the model ` +
            "cannot be shown. The image formats it can see are PNG, JPEG, GIF and WebP. " +
            "Convert it to one of those and read it again.",
        });
      }

      // Deliberately after the kind is known. The size check used to come
      // first, so a 2 MB screenshot was refused by the rule written for source
      // files and told to "search it instead" - advice that cannot be followed
      // on a PNG, about a limit that was never reasoning about pictures. Every
      // photograph a phone takes failed here.
      //
      // A picture is measured against the conversation's whole budget, not
      // just its own size, because every turn resends every image the
      // transcript holds: the limit that breaks a request is the total, and a
      // per-image check alone cannot see it coming.
      if (mimeType === undefined) {
        if (stat.size > MAX_TEXT_BYTES) {
          throw new ToolError("invalid_input", {
            message:
              `This file is ${Math.round(stat.size / 1024)} KB, which is too large to ` +
              "read at once. Search it instead.",
          });
        }
      } else {
        const refusal = pictureSizeRefusal(input.path, stat.size);
        if (refusal !== null) throw new ToolError("invalid_input", { message: refusal });
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
            { type: "text", text: `Attached: ${input.path} (${mimeType}${pixelSize(bytes)}).` },
            { type: "image", data: bytes.toString("base64"), mimeType },
          ],
        };
      }

      const content = await context.sandbox.readFile(input.path);
      let shown = content;

      if (content.includes("\0")) {
        // UTF-16 - what Notepad's "Unicode", PowerShell's Out-File and
        // Excel's Unicode export write - is all NULs read as UTF-8, and is
        // text all the same. Anything still holding NULs once decoded is
        // refused: returning binary as text produces plausible-looking
        // nonsense, which is worse, because the model reasons about it as if
        // it were real.
        const decoded = decodeTextBytes(await readFile(absolute));
        if (decoded === undefined) {
          throw new ToolError("invalid_input", {
            message: "This file is not text and cannot be read.",
          });
        }
        shown = decoded.text;
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

      return formatNumbered(shown, input.offset, input.limit);
    },
  });
}

function extensionOf(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}
