import type { DocumentPage } from "./types.js";

/**
 * What a vision language model is told when it stands in for an OCR engine,
 * and how its one answer is cut back into pages.
 *
 * A dedicated OCR endpoint answers a page array; a chat model answers prose.
 * The three adapters that read documents through a chat model (OpenAI's
 * Responses API, Google's Interactions API, OpenRouter's file parts) would
 * each have written this instruction and this splitter, and then drifted:
 * one asking for a heading per page, another for a rule, and the caller
 * left to guess which. One instruction, one marker, one cut, here.
 *
 * The marker is an HTML comment because it survives every Markdown
 * renderer unseen and no document's own text contains it. A model that
 * ignores the instruction and answers without markers is not refused: its
 * whole answer becomes one page, numbered as the first page asked for, so
 * the caller still gets the text it came for and the page count is where
 * the shortfall shows.
 */

const PAGE_MARKER = /^<!--\s*page\s+(\d+)\s*-->\s*$/im;

export function transcriptionInstruction(pages: readonly number[] | undefined): string {
  const which =
    pages === undefined || pages.length === 0
      ? "every page"
      : `only page${pages.length === 1 ? "" : "s"} ${pages.map(String).join(", ")}, skipping the others`;
  return (
    `Transcribe ${which} of this document to Markdown, exactly as written. ` +
    "Begin each page with a line of the form <!-- page N --> where N is that page's " +
    "number in the document, counting from 1. Keep headings, lists and tables as " +
    "Markdown; keep the reading order of columns. For a figure, chart or photograph, " +
    "write one bracketed line saying what it shows. Do not summarise, comment, " +
    "translate, or add anything that is not on the page."
  );
}

/** The model's answer, cut at its page markers into the pages it transcribed. */
export function pagesOfTranscript(
  transcript: string,
  requested: readonly number[] | undefined,
): readonly DocumentPage[] {
  const pieces = transcript.split(new RegExp(PAGE_MARKER.source, "gim"));
  // A split on a capturing group alternates text and captured number: the
  // text before the first marker comes first, then number, text, number...
  const leading = pieces[0]?.trim() ?? "";
  const pages: DocumentPage[] = [];
  for (let index = 1; index < pieces.length; index += 2) {
    const number = Number.parseInt(pieces[index] ?? "", 10);
    const markdown = (pieces[index + 1] ?? "").trim();
    if (!Number.isInteger(number) || number < 1) continue;
    pages.push({ number, markdown });
  }
  if (pages.length === 0) {
    const first = requested?.[0] ?? 1;
    return leading.length === 0 ? [] : [{ number: first, markdown: leading }];
  }
  return pages;
}
