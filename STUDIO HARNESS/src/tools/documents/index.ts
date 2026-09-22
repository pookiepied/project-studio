import { readFile } from "node:fs/promises";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { MediaError } from "../../contracts/media.js";
import { DocumentError } from "../../documents/errors.js";
import {
  DOCUMENT_MIME_BY_FORMAT,
  documentFormatOf,
  MAX_DOCUMENT_BYTES,
  parsePageRanges,
} from "../../documents/extract.js";
import type { MediaService } from "../../gateway/media/service.js";
import { ToolError } from "../errors.js";
import type { CallGate } from "../gate.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";

/**
 * The document tool: a page with no text layer, read through a provider.
 *
 * The read tool answers a document with its text layer, which is free and
 * usually complete. Where it is not - a scan, a photographed page, a PDF
 * whose text is pictures of text - the read's coverage note names the pages
 * and this tool reads them: the file, or a picture of one page, goes to
 * whatever the document-reading slot names in Settings, an OCR engine or a
 * vision model, and the pages come back as Markdown under the same [page N]
 * markers the read uses. The model escalates; nothing runs OCR on its own,
 * because a page the provider reads is a page somebody pays for.
 *
 * No vendor appears in the schema - the rule every gateway tool follows.
 * The one selector is pages, spelled the way the coverage note spells them,
 * so the note can be answered by pasting it.
 */

const OCR_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "ocr" },
  title: "Read pages through OCR",
  description:
    "Reads a PDF, Word, PowerPoint or Excel file, or a picture of a page, through the " +
    "document-reading provider chosen in Settings - an OCR engine or a vision model - and " +
    "answers with each page as Markdown under a [page N] marker. Use it for the pages read " +
    "reports as having no text layer, or when a page's layout, table or figure matters; the " +
    'text layer itself comes free from read. Name pages as "3-5,9"; omit pages to read the ' +
    "whole file, which costs a page fee or vision tokens for every page.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
      pages: {
        type: "string",
        description: 'Which pages, one-based, as "3-5,9". Omit for every page.',
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  effects: ["network"],
  provenance: NATIVE_PROVENANCE,
  idempotent: true,
};

/** OCR of a long file is slow work; Mistral's own examples take minutes. */
const OCR_DEADLINE_MS = 300_000;

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
};

export interface DocumentToolRegistration {
  readonly media: MediaService;
}

interface OcrInput {
  readonly path: string;
  readonly pages?: string;
}

function mimeTypeOf(path: string): string {
  const format = documentFormatOf(path);
  if (format !== undefined) return DOCUMENT_MIME_BY_FORMAT[format];
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const image = IMAGE_MIME_BY_EXTENSION[extension];
  if (image === undefined) {
    throw new ToolError("invalid_input", {
      message: `${path} is not a document or a picture the tool can send (pdf, docx, pptx, xlsx, or an image).`,
    });
  }
  return image;
}

/** How many pages a PDF has, so a selector past its end is refused here and not by the vendor. */
async function pdfPageCount(bytes: Uint8Array): Promise<number | undefined> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(bytes));
    return proxy.numPages;
  } catch {
    return undefined;
  }
}

function createOcrTool(registration: DocumentToolRegistration): ToolDefinition<OcrInput, string> {
  return defineStudioTool({
    descriptor: OCR_DESCRIPTOR,
    resourceKind: "command",
    deadlineMs: OCR_DEADLINE_MS,

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;
      if (typeof value.path !== "string" || value.path.trim() === "") {
        throw new ToolError("invalid_input", { message: "path is required." });
      }
      if (value.pages !== undefined && (typeof value.pages !== "string" || value.pages.trim() === "")) {
        throw new ToolError("invalid_input", { message: 'pages must be text such as "3-5,9".' });
      }
      return { path: value.path, ...(value.pages === undefined ? {} : { pages: value.pages }) };
    },

    // The provider is settings, and one approval covers the tool; the path it
    // reads is listed so a rule can name it.
    resource: () => undefined,
    resources: (input, context) => [context.sandbox.resolveRead(input.path)],

    execute: async (input, context) => {
      const mimeType = mimeTypeOf(input.path);
      const absolute = context.sandbox.resolveRead(input.path);
      let bytes: Buffer;
      try {
        bytes = await readFile(absolute);
      } catch {
        throw new ToolError("invalid_input", { message: `${input.path} could not be read.` });
      }
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
        throw new ToolError("invalid_input", {
          message:
            `${input.path} is ${String(Math.round(bytes.byteLength / (1024 * 1024)))} MB, past the ` +
            `${String(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB a provider takes. Split it first.`,
        });
      }
      let pages: readonly number[] | undefined;
      if (input.pages !== undefined) {
        const count = mimeType === "application/pdf" ? await pdfPageCount(bytes) : undefined;
        try {
          pages = parsePageRanges(input.pages, count);
        } catch (error) {
          if (error instanceof DocumentError) throw new ToolError("invalid_input", { message: error.message });
          throw error;
        }
      }
      const fileName = input.path.replace(/\\/g, "/").split("/").at(-1) ?? input.path;
      let read;
      try {
        read = await registration.media.readDocument({
          bytes: new Uint8Array(bytes),
          mimeType,
          fileName,
          ...(pages === undefined ? {} : { pages }),
        });
      } catch (error) {
        if (error instanceof MediaError) {
          throw new ToolError(error.kind === "slot-unset" ? "unavailable" : "execution_failed", {
            message: error.message,
          });
        }
        throw error;
      }
      const answered = new Set(read.pages.map((page) => page.number));
      const missing = (pages ?? []).filter((page) => !answered.has(page));
      const body = read.pages
        .map((page) => `[page ${String(page.number)}]\n${page.markdown}`)
        .join("\n\n");
      return missing.length === 0
        ? body
        : `${body}\n\n[The provider answered nothing for page${missing.length === 1 ? "" : "s"} ${missing.map(String).join(", ")}.]`;
    },
  });
}

export function registerDocumentTools(gate: CallGate, registration: DocumentToolRegistration): void {
  gate.register(createOcrTool(registration));
}
