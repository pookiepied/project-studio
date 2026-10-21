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
/**
 * Cells are placed by their column, so one stray cell far to the right
 * would pad every row it sits in with thousands of tabs. Past this column
 * the cells are cut and the sheet says so.
 */
const MAX_SHEET_COLUMNS = 1_024;

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

/**
 * The pages as one text, each under its own marker line. `only` keeps the
 * named pages (one-based) and their real numbers, so page 40 read alone is
 * still marked page 40.
 */
export function renderPages(document: ExtractedDocument, only?: readonly number[]): string {
  const wanted = only === undefined ? undefined : new Set(only);
  return document.pages
    .flatMap((page, index) => (wanted === undefined || wanted.has(index + 1) ? [`[${document.unit} ${String(index + 1)}]\n${page}`] : []))
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

/** The attributes of one start tag, by name, either quote style accepted. */
function attributesOf(tag: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1] ?? "", decodeEntities(match[2] ?? match[3] ?? ""));
  }
  return attributes;
}

/**
 * A package's relationships part as id to part name. Targets are relative
 * to the folder of the part that owns them (`xl/`, `ppt/`), or absolute
 * from the package root when they start with a slash.
 */
function relationshipsOf(archive: ZipArchive, relsPath: string, baseFolder: string): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  for (const match of (archive.text(relsPath) ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const attributes = attributesOf(match[0]);
    const id = attributes.get("Id");
    const target = attributes.get("Target");
    if (id === undefined || target === undefined) continue;
    targets.set(id, partName(baseFolder, target));
  }
  return targets;
}

function partName(baseFolder: string, target: string): string {
  const segments = target.startsWith("/") ? [] : baseFolder.split("/").filter((part) => part !== "");
  for (const segment of target.replace(/^\/+/, "").split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  return segments.join("/");
}

/** Private-use marks for the two kinds of page ending a Word body carries. */
const HARD_PAGE_BREAK = "\uE000";
const RENDERED_PAGE_BREAK = "\uE001";

/**
 * A Word document's text, cut into the pages Word last laid it out on:
 * `lastRenderedPageBreak` is where Word saved a page ending, and a hard
 * break the author inserted counts the same. A document saved without
 * either is one page, which is still the truth of what the reader gets.
 *
 * Word marks the page after a hard break twice - the break itself, then a
 * `lastRenderedPageBreak` at the start of the next page's first run - so a
 * rendered mark with nothing but markup between it and a hard break is the
 * same page ending, not a blank page. Counted twice, every hard break gave
 * an empty page, and two of them were enough to tell the model a Word file
 * needed OCR. Two hard breaks in a row are still two: that blank page is
 * the author's.
 */
function docxPages(archive: ZipArchive): readonly string[] {
  const xml = archive.text("word/document.xml");
  if (xml === undefined) {
    throw new DocumentError("malformed", "The file has no word/document.xml, so it is not a Word document.");
  }
  const body = xml
    .replace(/<w:lastRenderedPageBreak\s*\/>/g, RENDERED_PAGE_BREAK)
    .replace(/<w:br\b[^>]*\bw:type\s*=\s*["']page["'][^>]*\/>/g, HARD_PAGE_BREAK)
    .replace(new RegExp(`(${HARD_PAGE_BREAK}(?:<[^>]*>|\\s)*)${RENDERED_PAGE_BREAK}`, "g"), "$1")
    // Only the bare run tab: `<w:tab w:val=... w:pos=...>` is a tab stop
    // definition in paragraph properties, not a character.
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t");
  return body
    .split(new RegExp(`[${HARD_PAGE_BREAK}${RENDERED_PAGE_BREAK}]`))
    .map((page) => textOfMarkup(page).trim());
}

/** Markup to its text: every tag dropped, entities decoded, blank runs squeezed. */
function textOfMarkup(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The parts a container lists, in the container's own order: each start
 * tag's relationship id resolved through the owner's relationships part.
 * Undefined when the order cannot be read - no list, no relationships, or
 * an entry naming a part the package does not hold - so the caller falls
 * back to the parts' numbering rather than reading a partial list.
 */
function partsInOrder(
  archive: ZipArchive,
  listXml: string,
  entryTag: RegExp,
  relsPath: string,
  baseFolder: string,
): readonly { readonly part: string; readonly attributes: ReadonlyMap<string, string> }[] | undefined {
  const relationships = relationshipsOf(archive, relsPath, baseFolder);
  if (relationships.size === 0) return undefined;
  const present = new Set(archive.names());
  const parts: { part: string; attributes: ReadonlyMap<string, string> }[] = [];
  for (const match of listXml.matchAll(entryTag)) {
    const attributes = attributesOf(match[0]);
    const part = relationships.get(relationshipIdOf(attributes) ?? "");
    if (part === undefined || !present.has(part)) return undefined;
    parts.push({ part, attributes });
  }
  return parts.length === 0 ? undefined : parts;
}

/**
 * The relationship id on a list entry. The namespace prefix is the
 * generator's choice - `r:` from Office, others from some libraries - and
 * an unprefixed `id` is the entry's own number (`sldId id="256"`), not one.
 */
function relationshipIdOf(attributes: ReadonlyMap<string, string>): string | undefined {
  for (const [name, value] of attributes) if (name.endsWith(":id")) return value;
  return undefined;
}

/** The parts matching `pattern`, by the number in their names - the order when nothing better is written down. */
function numberedParts(archive: ZipArchive, pattern: RegExp): readonly string[] {
  return archive
    .names()
    .map((name) => pattern.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number.parseInt(a[1] ?? "0", 10) - Number.parseInt(b[1] ?? "0", 10))
    .map((match) => match[0]);
}

/**
 * One page per slide, in the deck's own order, each starting with its title
 * text. The order is `presentation.xml`'s slide list, not the slide files'
 * numbers: PowerPoint keeps a moved slide's file name, so a reordered deck
 * numbered by file would put the wrong slide under `[slide N]`.
 */
function pptxSlides(archive: ZipArchive): readonly string[] {
  const listed = partsInOrder(
    archive,
    archive.text("ppt/presentation.xml") ?? "",
    /<p:sldId\b[^>]*>/g,
    "ppt/_rels/presentation.xml.rels",
    "ppt",
  );
  const slides = listed?.map((entry) => entry.part) ?? numberedParts(archive, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (slides.length === 0) {
    throw new DocumentError("malformed", "The file has no slides, so it is not a PowerPoint deck.");
  }
  return slides.map((part) => {
    const xml = archive.text(part) ?? "";
    // A paragraph's runs join without a break; paragraphs end one.
    const paragraphs = xml.split(/<\/a:p>/).map((paragraph) => textsOf(paragraph, "a:t").join(""));
    return paragraphs.join("\n").trim();
  });
}

/**
 * The shared string table, one entry per `<si>`. A rich-text entry holds a
 * `<t>` per formatted run, and those runs are one string - reading every
 * `<t>` as its own entry shifted every later index, so cells silently showed
 * their neighbours' text. Phonetic guides (`<rPh>`) are annotations on the
 * string, not part of it.
 */
function sharedStringsOf(xml: string): readonly string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    const inner = (match[1] ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    strings.push(textsOf(inner, "t").join(""));
  }
  return strings;
}

/** "C" is 3, "AA" is 27: a cell reference's column, one-based; undefined when it has none. */
function columnOf(reference: string | undefined): number | undefined {
  const letters = /^([A-Z]+)\d*$/i.exec(reference ?? "")?.[1];
  if (letters === undefined) return undefined;
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column;
}

/** The worksheets in the workbook's own order with their names, or by file number when that order is unreadable. */
function worksheetsOf(archive: ZipArchive, workbook: string): readonly { readonly part: string; readonly name: string }[] {
  const listed = partsInOrder(archive, workbook, /<sheet\b[^>]*>/g, "xl/_rels/workbook.xml.rels", "xl");
  if (listed !== undefined) {
    // A chart sheet is listed among the sheets but holds no cells.
    return listed
      .filter((entry) => entry.part.startsWith("xl/worksheets/"))
      .map((entry, index) => ({ part: entry.part, name: entry.attributes.get("name") ?? `Sheet ${String(index + 1)}` }));
  }
  const names = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match) => attributesOf(match[0]).get("name"));
  return numberedParts(archive, /^xl\/worksheets\/sheet(\d+)\.xml$/).map((part, index) => ({
    part,
    name: names[index] ?? `Sheet ${String(index + 1)}`,
  }));
}

/**
 * One page per sheet, each as tab-separated rows with the sheet's name on
 * the first line. Shared strings are resolved; formulas give their cached
 * value, which is what the person sees in the cell.
 *
 * A cell sits in the column its reference names. Excel writes no element
 * for an empty cell, so joining the cells it did write moved every value
 * after a gap one column left - under the wrong header, with nothing to
 * show it had moved. A formatted empty cell is written self-closed, and is
 * read as the empty cell it is rather than as the start of its neighbour.
 */
function xlsxSheets(archive: ZipArchive): readonly string[] {
  const workbook = archive.text("xl/workbook.xml");
  if (workbook === undefined) {
    throw new DocumentError("malformed", "The file has no xl/workbook.xml, so it is not an Excel workbook.");
  }
  const shared = sharedStringsOf(archive.text("xl/sharedStrings.xml") ?? "");
  const sheets = worksheetsOf(archive, workbook);
  if (sheets.length === 0) {
    throw new DocumentError("malformed", "The workbook has no sheets.");
  }
  return sheets.map((sheet) => {
    const xml = archive.text(sheet.part) ?? "";
    const rows: string[] = [];
    let cutRows = false;
    let cutColumns = false;
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= MAX_SHEET_ROWS) {
        cutRows = true;
        break;
      }
      const cells: string[] = [];
      for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = attributesOf(cell[1] ?? "");
        const inner = cell[2] ?? "";
        const column = columnOf(attributes.get("r")) ?? cells.length + 1;
        if (column > MAX_SHEET_COLUMNS) {
          cutColumns = true;
          continue;
        }
        const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        const type = attributes.get("t");
        let text: string;
        if (type === "s" && value !== undefined) {
          text = shared[Number.parseInt(value, 10)] ?? "";
        } else if (type === "inlineStr") {
          text = textsOf(inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ""), "t").join("");
        } else {
          text = value === undefined ? "" : decodeEntities(value);
        }
        while (cells.length < column - 1) cells.push("");
        cells[column - 1] = text;
      }
      while (cells.length > 0 && cells.at(-1) === "") cells.pop();
      rows.push(cells.join("\t"));
    }
    const trailer =
      (cutColumns ? `\n[columns past ${String(MAX_SHEET_COLUMNS)} are not shown]` : "") +
      (cutRows ? `\n[only the first ${String(MAX_SHEET_ROWS)} rows are shown]` : "");
    return `${sheet.name}\n${rows.join("\n")}${trailer}`.trim();
  });
}
