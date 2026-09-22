import { DocumentError } from "./errors.js";
import { ZipArchive } from "./zip.js";

/**
 * A document as text, one entry per page, and what the text layer failed
 * to cover.
 *
 * The engine under Studio carries text and pictures to the model and
 * nothing else, so every document a person hands it becomes text on this
 * side first. Four formats are read here - PDF, and the three Office
 * containers - and the answer is the same shape for all of them, because
 * the readers (the read tool, the upload route, the library) want the same
 * two things whatever the format: the words, page by page, and an honest
 * account of the pages that gave none.
 *
 * ---- Coverage, not just text ---------------------------------------------
 *
 * A text-layer extractor answers a scanned page with nothing, and a PDF
 * that is mostly scans converts "successfully" into silent loss. So every
 * page is measured: under twenty characters is empty, and when enough
 * pages are empty the document carries a note naming them, prepended -
 * because a paged read may never reach a footer - and telling the model
 * how to recover: the `ocr` tool, which reads those pages through the
 * document-reading provider. The thresholds are Hermes Agent's, which
 * arrived at them the hard way: a couple of blank pages in a long text
 * document is a cover and a divider, not a scan.
 *
 * ---- Why pages ----------------------------------------------------------
 *
 * A page number is how a person and the model both name a place in a
 * document, and the one thing the OCR provider takes as a selector. Each
 * page is marked in the rendered text so a number the model reads is a
 * number it can ask for. A slide and a sheet are that format's page.
 */

export type DocumentFormat = "pdf" | "docx" | "pptx" | "xlsx";

/** What one entry of `pages` is called for the format. */
export type PageUnit = "page" | "slide" | "sheet";

export interface ExtractedDocument {
  readonly format: DocumentFormat;
  readonly unit: PageUnit;
  /** One entry per page, in order; the text a page gave, trimmed. */
  readonly pages: readonly string[];
  /** One-based numbers of the pages that gave no text. */
  readonly emptyPages: readonly number[];
}

/** The largest document opened here; past this the pages are the person's to split. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** Fewer extracted characters than this and the page is a picture, a divider, or blank. */
const EMPTY_PAGE_CHARS = 20;
/** Warn when this many pages are empty and they are this share of the whole... */
const COVERAGE_MIN_EMPTY = 2;
const COVERAGE_MIN_RATIO = 0.2;
/** ...or when this many are, whatever the share. */
const COVERAGE_ABSOLUTE_EMPTY = 10;
/** A sheet past this many rows is a data file; the model searches it or asks for a range. */
const MAX_SHEET_ROWS = 5_000;

const FORMAT_BY_EXTENSION: Readonly<Record<string, DocumentFormat>> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
};

export const DOCUMENT_MIME_BY_FORMAT: Readonly<Record<DocumentFormat, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** The format a file name declares, or undefined for a name this module does not read. */
export function documentFormatOf(fileName: string): DocumentFormat | undefined {
  const base = fileName.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return FORMAT_BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
}

export async function extractDocument(bytes: Uint8Array, format: DocumentFormat): Promise<ExtractedDocument> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(
      "too-large",
      `The document is ${String(Math.round(bytes.byteLength / (1024 * 1024)))} MB, past the ` +
        `${String(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB that is read here. Split it, or extract the pages you need with a command.`,
    );
  }
  switch (format) {
    case "pdf":
      return withCoverage("pdf", "page", await pdfPages(bytes));
    case "docx":
      return withCoverage("docx", "page", docxPages(new ZipArchive(bytes)));
    case "pptx":
      return withCoverage("pptx", "slide", pptxSlides(new ZipArchive(bytes)));
    case "xlsx":
      return withCoverage("xlsx", "sheet", xlsxSheets(new ZipArchive(bytes)));
  }
}

function withCoverage(format: DocumentFormat, unit: PageUnit, pages: readonly string[]): ExtractedDocument {
  const emptyPages: number[] = [];
  pages.forEach((page, index) => {
    if (page.replace(/\s+/g, "").length < EMPTY_PAGE_CHARS) emptyPages.push(index + 1);
  });
  return { format, unit, pages, emptyPages };
}

/** Whether the empty pages are enough to say so before the text. */
export function needsOcr(pageCount: number, emptyPages: readonly number[]): boolean {
  const empty = emptyPages.length;
  if (empty === 0) return false;
  if (empty === pageCount) return true;
  if (empty >= COVERAGE_ABSOLUTE_EMPTY) return true;
  return empty >= COVERAGE_MIN_EMPTY && empty / pageCount >= COVERAGE_MIN_RATIO;
}

/**
 * The note that goes in front of a document whose text layer is short of
 * its pages: which pages are missing, and the tool that reads them. Empty
 * for a document that covers itself.
 */
export function coverageNote(document: ExtractedDocument, path: string): string {
  if (!needsOcr(document.pages.length, document.emptyPages)) return "";
  const unit = document.unit;
  const all = document.emptyPages.length === document.pages.length;
  const which = all
    ? `every ${unit} of this document (${String(document.pages.length)})`
    : `${unit}${document.emptyPages.length === 1 ? "" : "s"} ${pageList(document.emptyPages)} of this document`;
  return (
    `[NEEDS OCR: ${which} ${all ? "is" : "are"} scanned images or pictures with no text layer - ` +
    `their content is missing below. If those ${unit}s matter, call ocr with path "${path}"` +
    `${all ? "" : ` and pages "${pageRanges(document.emptyPages)}"`} to read them through the ` +
    "document-reading provider chosen in Settings.]\n\n"
  );
}

/** The pages as one text, each under its own marker line. */
export function renderPages(document: ExtractedDocument): string {
  return document.pages
    .map((page, index) => `[${document.unit} ${String(index + 1)}]\n${page}`)
    .join("\n\n");
}

/** "3, 4, 7" for a few; "3, 4, 7 and 12 more" past twenty. */
function pageList(pages: readonly number[]): string {
  const shown = pages.slice(0, 20).map(String).join(", ");
  return pages.length > 20 ? `${shown} and ${String(pages.length - 20)} more` : shown;
}

/** "3-5,9" - the selector the ocr tool takes, so the note can be pasted. */
export function pageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (const page of sorted) {
    if (start === undefined || previous === undefined) {
      start = page;
    } else if (page !== previous + 1) {
      ranges.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`);
      start = page;
    }
    previous = page;
  }
  if (start !== undefined && previous !== undefined) {
    ranges.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`);
  }
  return ranges.join(",");
}

/**
 * "3-5,9" back to pages, bounded and one-based. A selector that names
 * nothing, or a page the document does not have, is refused with the
 * count, because the vendor would otherwise answer for the wrong pages.
 */
export function parsePageRanges(selector: string, pageCount: number | undefined): readonly number[] {
  const pages = new Set<number>();
  for (const piece of selector.split(",")) {
    const part = piece.trim();
    if (part === "") continue;
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (match === null) {
      throw new DocumentError("malformed", `"${part}" is not a page or a range; write pages as "3-5,9".`);
    }
    const first = Number.parseInt(match[1] ?? "0", 10);
    const last = match[2] === undefined ? first : Number.parseInt(match[2], 10);
    if (first < 1 || last < first) {
      throw new DocumentError("malformed", `"${part}" is not a page or a range; pages count from 1.`);
    }
    if (pageCount !== undefined && last > pageCount) {
      throw new DocumentError(
        "malformed",
        `The document has ${String(pageCount)} pages; "${part}" asks past the end.`,
      );
    }
    for (let page = first; page <= last; page += 1) pages.add(page);
  }
  if (pages.size === 0) {
    throw new DocumentError("malformed", 'No pages were named; write pages as "3-5,9".');
  }
  return [...pages].sort((a, b) => a - b);
}

/* ---- PDF ---------------------------------------------------------------- */

/**
 * `unpdf` is loaded on the first PDF and not before: it brings pdf.js with
 * it, and a harness that never meets a PDF should not pay for one at boot.
 * An unreadable file - encrypted, truncated, not a PDF despite its name -
 * is a `malformed` refusal with pdf.js's own reason.
 */
async function pdfPages(bytes: Uint8Array): Promise<readonly string[]> {
  const { extractText } = await import("unpdf");
  let text: string | string[];
  try {
    ({ text } = await extractText(new Uint8Array(bytes), { mergePages: false }));
  } catch (error) {
    throw new DocumentError(
      "malformed",
      `The PDF could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return (Array.isArray(text) ? text : [text]).map((page) => page.trim());
}

/* ---- Office ------------------------------------------------------------- */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** The text of every `<tag>` element, in document order. */
function textsOf(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  const found: string[] = [];
  for (const match of xml.matchAll(pattern)) found.push(decodeEntities(match[1] ?? ""));
  return found;
}

/**
 * A Word document's text, cut into the pages Word last laid it out on:
 * `lastRenderedPageBreak` is where Word saved a page ending, and a hard
 * break the author inserted counts the same. A document saved without
 * either is one page, which is still the truth of what the reader gets.
 */
function docxPages(archive: ZipArchive): readonly string[] {
  const xml = archive.text("word/document.xml");
  if (xml === undefined) {
    throw new DocumentError("malformed", "The file has no word/document.xml, so it is not a Word document.");
  }
  const body = xml
    .replace(/<w:lastRenderedPageBreak\/>/g, "\u000c")
    .replace(/<w:br w:type="page"\/>/g, "\u000c")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t");
  return body.split("\u000c").map((page) => textOfMarkup(page).trim());
}

/** Markup to its text: every tag dropped, entities decoded, blank runs squeezed. */
function textOfMarkup(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** One page per slide, in the deck's own order, each starting with its title text. */
function pptxSlides(archive: ZipArchive): readonly string[] {
  const slides = archive
    .names()
    .map((name) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number.parseInt(a[1] ?? "0", 10) - Number.parseInt(b[1] ?? "0", 10));
  if (slides.length === 0) {
    throw new DocumentError("malformed", "The file has no slides, so it is not a PowerPoint deck.");
  }
  return slides.map((match) => {
    const xml = archive.text(match[0]) ?? "";
    // A paragraph's runs join without a break; paragraphs end one.
    const paragraphs = xml.split(/<\/a:p>/).map((paragraph) => textsOf(paragraph, "a:t").join(""));
    return paragraphs.join("\n").trim();
  });
}

/**
 * One page per sheet, each as tab-separated rows with the sheet's name on
 * the first line. Shared strings are resolved; formulas give their cached
 * value, which is what the person sees in the cell.
 */
function xlsxSheets(archive: ZipArchive): readonly string[] {
  const workbook = archive.text("xl/workbook.xml");
  if (workbook === undefined) {
    throw new DocumentError("malformed", "The file has no xl/workbook.xml, so it is not an Excel workbook.");
  }
  const shared = textsOf(archive.text("xl/sharedStrings.xml") ?? "", "t");
  const names: string[] = [];
  for (const match of workbook.matchAll(/<sheet\s[^>]*name="([^"]*)"[^>]*\/?>/g)) {
    names.push(decodeEntities(match[1] ?? ""));
  }
  const sheets = archive
    .names()
    .map((name) => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number.parseInt(a[1] ?? "0", 10) - Number.parseInt(b[1] ?? "0", 10));
  if (sheets.length === 0) {
    throw new DocumentError("malformed", "The workbook has no sheets.");
  }
  return sheets.map((match, index) => {
    const xml = archive.text(match[0]) ?? "";
    const rows: string[] = [];
    let cut = false;
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_SHEET_ROWS) {
        cut = true;
        break;
      }
      const cells: string[] = [];
      for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attributes = cell[1] ?? "";
        const inner = cell[2] ?? "";
        const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        const isShared = /\bt="s"/.test(attributes);
        if (isShared && value !== undefined) {
          cells.push(shared[Number.parseInt(value, 10)] ?? "");
        } else if (/\bt="inlineStr"/.test(attributes)) {
          cells.push(textsOf(inner, "t").join(""));
        } else {
          cells.push(value === undefined ? "" : decodeEntities(value));
        }
      }
      rows.push(cells.join("\t"));
    }
    const title = names[index] ?? `Sheet ${String(index + 1)}`;
    const trailer = cut ? `\n[only the first ${String(MAX_SHEET_ROWS)} rows are shown]` : "";
    return `${title}\n${rows.join("\n")}${trailer}`.trim();
  });
}
