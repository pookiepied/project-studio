import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationDocumentStore, INLINE_CHARS, announcementOf } from "../../src/conversations/documents.js";
import type { ExecutionScope } from "../../src/contracts/capabilities.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import {
  coverageNote,
  extractDocument,
  needsOcr,
  pageRanges,
  parsePageRanges,
  renderPages,
} from "../../src/documents/extract.js";
import { ZipArchive } from "../../src/documents/zip.js";
import { CapabilityResolver } from "../../src/gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { MediaService } from "../../src/gateway/media/service.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { registerDocumentTools } from "../../src/tools/documents/index.js";
import { registerFilesystemTools } from "../../src/tools/filesystem/index.js";
import { CallGate } from "../../src/tools/gate.js";
import { createConversationRoutes } from "../../src/transport/http/routes/conversations.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { createAdmissionMiddleware, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { Hono } from "hono";

/**
 * Documents as text: the four readers over fixtures built by hand, the
 * coverage rule that names scanned pages, the read tool's page markers,
 * the conversation store that saves and announces an upload, the route
 * that carries the bytes, and the ocr tool escalating to a provider.
 */

/* ---- Fixtures ----------------------------------------------------------- */

/**
 * A PDF with one content stream per page, written the way pdf.js reads it:
 * objects, an xref table with byte offsets, a trailer. Uncompressed, so the
 * text is right there for the extractor and for a reader of the test.
 */
function pdfOf(pages: readonly string[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font; then per page: page, content.
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(""); // pages, filled below
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const text of pages) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentId)} 0 R >>`,
    );
    const stream = text === "" ? "" : `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects.push(`<< /Length ${String(Buffer.byteLength(stream))} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(" ")}] /Count ${String(pages.length)} >>`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** A ZIP of named text entries, deflated, with the central directory a reader walks. */
function zipOf(entries: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const DOCX = zipOf({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml":
    '<w:document><w:body><w:p><w:r><w:t>First page &amp; its words, enough of them to count</w:t></w:r></w:p>' +
    '<w:p><w:r><w:lastRenderedPageBreak/><w:t xml:space="preserve">Second page, with its own words on it</w:t></w:r></w:p></w:body></w:document>',
});

const PPTX = zipOf({
  "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Slide two</a:t></a:r></a:p></p:sld>",
  "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Slide </a:t></a:r><a:r><a:t>one</a:t></a:r></a:p><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:sld>",
  "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Slide ten</a:t></a:r></a:p></p:sld>",
});

const XLSX = zipOf({
  "xl/workbook.xml": '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><t>Cost</t></si><si><t>Chair</t></si></sst>",
  "xl/worksheets/sheet1.xml":
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42.5</v></c></row>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>Desk</t></is></c><c r="B3"><f>B2*2</f><v>85</v></c></row></sheetData></worksheet>',
});

/* ---- The readers ---------------------------------------------------------- */

describe("reading a document as pages", () => {
  it("reads a PDF page by page and names the pages that gave no text", async () => {
    const document = await extractDocument(pdfOf(["Hello document, the first page of three", "", ""]), "pdf");
    expect(document.unit).toBe("page");
    expect(document.pages).toHaveLength(3);
    expect(document.pages[0]).toContain("Hello document, the first page of three");
    expect(document.emptyPages).toEqual([2, 3]);
    expect(renderPages(document)).toMatch(/^\[page 1\]\nHello document, the first/);
    expect(renderPages(document)).toContain("[page 3]");
  });

  it("refuses bytes that are not the PDF the name claims, with pdf.js's reason", async () => {
    await expect(extractDocument(Buffer.from("not a pdf"), "pdf")).rejects.toMatchObject({
      domain: "documents",
      kind: "malformed",
      message: expect.stringContaining("could not be opened"),
    });
  });

  it("reads a Word document at the page breaks Word last rendered, entities decoded", async () => {
    const document = await extractDocument(DOCX, "docx");
    expect(document.pages).toEqual(["First page & its words, enough of them to count", "Second page, with its own words on it"]);
    expect(document.emptyPages).toEqual([]);
  });

  it("reads a deck one slide per page, in the deck's numeric order", async () => {
    const document = await extractDocument(PPTX, "pptx");
    expect(document.unit).toBe("slide");
    expect(document.pages).toEqual(["Slide one\nBody", "Slide two", "Slide ten"]);
  });

  it("reads a workbook one sheet per page as tab-separated rows, strings and cached values resolved", async () => {
    const document = await extractDocument(XLSX, "xlsx");
    expect(document.unit).toBe("sheet");
    expect(document.pages).toEqual(["Budget\nItem\tCost\nChair\t42.5\nDesk\t85"]);
  });

  it("refuses an Office file that is not a ZIP, or lacks its part", async () => {
    await expect(extractDocument(Buffer.from("plain"), "docx")).rejects.toMatchObject({ kind: "malformed" });
    await expect(extractDocument(zipOf({ "a.txt": "x" }), "docx")).rejects.toMatchObject({
      kind: "malformed",
      message: expect.stringContaining("word/document.xml"),
    });
  });

  it("opens a ZIP's entries by name and inflates them", () => {
    const archive = new ZipArchive(zipOf({ "a/b.txt": "hello", "c.txt": "" }));
    expect(archive.names()).toEqual(["a/b.txt", "c.txt"]);
    expect(archive.text("a/b.txt")).toBe("hello");
    expect(archive.text("c.txt")).toBe("");
    expect(archive.text("missing")).toBeUndefined();
  });
});

describe("coverage", () => {
  it("warns at two empty pages and a fifth, at ten whatever the share, and for a whole scan", () => {
    expect(needsOcr(10, [3, 4])).toBe(true);
    expect(needsOcr(20, [3, 4])).toBe(false);
    expect(needsOcr(200, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(true);
    expect(needsOcr(1, [1])).toBe(true);
    expect(needsOcr(50, [7])).toBe(false);
    expect(needsOcr(3, [])).toBe(false);
  });

  it("puts the note in front, naming the pages and the tool call that reads them", async () => {
    const document = await extractDocument(pdfOf(["Text enough to fill a page of it", "", "", "More text enough to fill a page", ""]), "pdf");
    const note = coverageNote(document, "scan.pdf");
    expect(note).toMatch(/^\[NEEDS OCR: pages 2, 3, 5 of this document are scanned/);
    expect(note).toContain('call ocr with path "scan.pdf" and pages "2-3,5"');
    expect(coverageNote(await extractDocument(pdfOf(["Text enough to fill a page of it", "Words enough to fill a page of it"]), "pdf"), "a.pdf")).toBe("");
  });

  it("spells page ranges both ways", () => {
    expect(pageRanges([5, 3, 4, 9, 4])).toBe("3-5,9");
    expect(parsePageRanges("3-5,9", 12)).toEqual([3, 4, 5, 9]);
    expect(() => parsePageRanges("3-5,90", 12)).toThrow(/12 pages/);
    expect(() => parsePageRanges("x", undefined)).toThrow(/not a page/);
    expect(() => parsePageRanges("", undefined)).toThrow(/No pages/);
  });
});

/* ---- The read tool and the ocr tool ------------------------------------- */

const SCOPE: ExecutionScope = { conversationId: "conv-1", projectId: "proj-1", agentId: "studio" };

interface Seen {
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
}

let standIn: { server: Server; port: number; seen: Seen[]; answer: (seen: Seen) => unknown };

async function startStandIn(): Promise<typeof standIn> {
  const state: typeof standIn = { server: undefined as unknown as Server, port: 0, seen: [], answer: () => ({}) };
  state.server = createServer((request, response) => {
    const received: Buffer[] = [];
    request.on("data", (chunk: Buffer) => received.push(chunk));
    request.on("end", () => {
      const seen = { path: request.url ?? "", headers: request.headers, body: Buffer.concat(received) };
      state.seen.push(seen);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state.answer(seen)));
    });
  });
  await new Promise<void>((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  state.port = (state.server.address() as AddressInfo).port;
  return state;
}

describe("the tools", () => {
  let db: StudioDatabase;
  let workspace: string;
  let gate: CallGate;
  let media: MediaService;

  beforeEach(async () => {
    db = openDatabase({ path: ":memory:" });
    workspace = mkdtempSync(join(tmpdir(), "studio-docs-"));
    standIn = await startStandIn();
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    await connections.add({
      id: "mistral",
      displayName: "Mistral",
      serves: { language: "mistral-conversations", media: "mistral" },
      source: "local",
      enabled: true,
      catalogProvider: "mistral",
      baseUrl: `http://127.0.0.1:${String(standIn.port)}/v1`,
      apiKey: "ms-key",
    });
    const catalog = new ModelCatalog({ db, connections });
    await catalog.setDefault("documentReading", { connectionId: "mistral", modelId: "mistral-ocr-latest" });
    media = new MediaService({ resolver: new CapabilityResolver({ connections, catalog, credentials }) });
    const kernel = new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
    });
    gate = new CallGate({ kernel, sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })) });
    registerFilesystemTools(gate);
    registerDocumentTools(gate, { media });
  });

  afterEach(() => {
    standIn.server.closeAllConnections();
    standIn.server.close();
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  const call = (name: string, input: unknown) => gate.call({ name, input, scope: SCOPE }) as Promise<string>;

  it("read answers a PDF under page markers with the coverage note first", async () => {
    writeFileSync(join(workspace, "scan.pdf"), pdfOf(["Cover words here, enough to count as text", "", ""]));
    const output = await call("native/read", { path: "scan.pdf" });
    expect(output).toContain("[NEEDS OCR: pages 2, 3 of this document");
    expect(output).toContain('call ocr with path "scan.pdf" and pages "2-3"');
    expect(output).toContain("[page 1]");
    expect(output).toContain("Cover words here, enough to count as text");
  });

  it("read answers a Word document, a deck and a workbook the same way", async () => {
    writeFileSync(join(workspace, "notes.docx"), DOCX);
    writeFileSync(join(workspace, "deck.pptx"), PPTX);
    writeFileSync(join(workspace, "budget.xlsx"), XLSX);
    expect(await call("native/read", { path: "notes.docx" })).toContain("[page 2]\n");
    expect(await call("native/read", { path: "deck.pptx" })).toContain("[slide 3]");
    expect(await call("native/read", { path: "budget.xlsx" })).toContain("Chair\t42.5");
  });

  it("ocr sends the file and the pages to the provider and answers pages under markers", async () => {
    writeFileSync(join(workspace, "scan.pdf"), pdfOf(["Cover", "", ""]));
    standIn.answer = () => ({ pages: [{ index: 1, markdown: "Scanned two" }, { index: 2, markdown: "Scanned three" }] });
    const output = await call("native/ocr", { path: "scan.pdf", pages: "2-3" });
    expect(output).toBe("[page 2]\nScanned two\n\n[page 3]\nScanned three");
    const sent = JSON.parse(standIn.seen[0]?.body.toString("utf8") ?? "{}") as Record<string, unknown>;
    expect(sent.pages).toEqual([1, 2]);
    expect((sent.document as Record<string, unknown>).document_name).toBe("scan.pdf");
    expect(standIn.seen[0]?.headers.authorization).toBe("Bearer ms-key");
  });

  it("ocr refuses a page past the end before the wire, and names what the provider left out", async () => {
    writeFileSync(join(workspace, "scan.pdf"), pdfOf(["Cover", ""]));
    await expect(call("native/ocr", { path: "scan.pdf", pages: "5" })).rejects.toThrow(/2 pages/);
    expect(standIn.seen).toHaveLength(0);
    standIn.answer = () => ({ pages: [{ index: 0, markdown: "One" }] });
    expect(await call("native/ocr", { path: "scan.pdf", pages: "1-2" })).toContain("answered nothing for page 2");
  });

  it("ocr says when no document-reading model is connected", async () => {
    const bare = openDatabase({ path: ":memory:" });
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db: bare, credentials });
    const catalog = new ModelCatalog({ db: bare, connections });
    const unset = new MediaService({ resolver: new CapabilityResolver({ connections, catalog, credentials }) });
    const kernel = new PermissionKernel({
      grants: new PermissionGrantStore(bare),
      approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
    });
    const own = new CallGate({ kernel, sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })) });
    registerDocumentTools(own, { media: unset });
    writeFileSync(join(workspace, "page.png"), Buffer.from([0x89, 0x50]));
    await expect(own.call({ name: "native/ocr", input: { path: "page.png" }, scope: SCOPE })).rejects.toThrow(
      /No document reading model is connected/,
    );
    bare.close();
  });
});

/* ---- The conversation's documents ---------------------------------------- */

describe("a conversation's documents", () => {
  let db: StudioDatabase;
  let root: string;
  let store: ConversationDocumentStore;
  let now: number;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    root = mkdtempSync(join(tmpdir(), "studio-docs-store-"));
    now = 1_000;
    store = new ConversationDocumentStore(db, {
      now: () => now,
      directoryFor: (conversationId) => join(root, conversationId, "attachments"),
    });
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("saves the file beside the pictures, reads it once, and inlines a short one", async () => {
    const document = await store.add("conv-1", { fileName: "..\\evil/../report.pdf", mimeType: "application/pdf", bytes: pdfOf(["Quarterly figures for the year so far", ""]) });
    expect(document.fileName).toBe("report.pdf");
    expect(document.path).toBe(join(root, "conv-1", "attachments", "report.pdf"));
    expect(readdirSync(join(root, "conv-1", "attachments"))).toEqual(["report.pdf"]);
    expect(document.pageCount).toBe(2);
    expect(document.emptyPages).toEqual([2]);
    expect(document.inlineText).toContain("[page 1]\nQuarterly figures for the year so far");
    expect(document.announcedAt).toBeNull();
    expect(store.list("conv-1")).toEqual([document]);
    expect(store.list("conv-2")).toEqual([]);
  });

  it("keeps a long document by path alone, and a plain text file as itself", async () => {
    const long = await store.add("conv-1", { fileName: "book.txt", mimeType: "text/plain", bytes: Buffer.from("x".repeat(INLINE_CHARS + 1)) });
    expect(long.inlineText).toBeNull();
    expect(long.pageCount).toBe(1);
    const short = await store.add("conv-1", { fileName: "note.md", mimeType: "text/markdown", bytes: Buffer.from("# Note") });
    expect(short.inlineText).toBe("# Note");
  });

  it("refuses what it cannot read, with the reason, and writes nothing for it", async () => {
    await expect(store.add("conv-1", { fileName: "x.pdf", mimeType: "application/pdf", bytes: Buffer.from("no") })).rejects.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining("could not be opened"),
    });
    await expect(store.add("conv-1", { fileName: "x.exe", mimeType: "application/octet-stream", bytes: Buffer.from([1]) })).rejects.toMatchObject({
      kind: "invalid",
      message: expect.stringContaining("not a document"),
    });
    await expect(store.add("conv-1", { fileName: "x.txt", mimeType: "text/plain", bytes: Buffer.alloc(0) })).rejects.toMatchObject({ kind: "invalid" });
    expect(store.list("conv-1")).toEqual([]);
  });

  it("announces what was attached since the last announcement, once", async () => {
    const first = await store.add("conv-1", { fileName: "a.pdf", mimeType: "application/pdf", bytes: pdfOf(["Alpha words, enough of them to be a page"]) });
    await store.add("conv-1", { fileName: "b.txt", mimeType: "text/plain", bytes: Buffer.from("x".repeat(INLINE_CHARS + 1)) });
    now = 2_000;
    const announcement = store.announce("conv-1");
    expect(announcement?.documents.map((document) => document.fileName)).toEqual(["a.pdf", "b.txt"]);
    expect(announcement?.documents[0]?.announcedAt).toBe(2_000);
    expect(announcement?.body).toContain(`The user attached "a.pdf" (1 page, 0.00 MB). It is saved at: ${first.path}`);
    expect(announcement?.body).toContain("Its text follows.\n\n[page 1]\nAlpha words, enough of them to be a page");
    expect(announcement?.body).toContain('The user attached "b.txt" (1 page');
    expect(announcement?.body).toContain("Its text is not inlined here: read it with the read tool");
    expect(store.announce("conv-1")).toBeUndefined();
    expect(store.list("conv-1").every((document) => document.announcedAt === 2_000)).toBe(true);
  });

  it("tells the model which pages are scans, in the words the ocr tool takes", async () => {
    const scanned = await store.add("conv-1", { fileName: "scan.pdf", mimeType: "application/pdf", bytes: pdfOf(["Cover words, enough of them to be a page", "", ""]) });
    expect(announcementOf(scanned)).toContain('pages 2-3 are scanned images with no text layer; call ocr with that path and pages "2-3"');
    const whole = await store.add("conv-1", { fileName: "whole.pdf", mimeType: "application/pdf", bytes: pdfOf(["", ""]) });
    expect(announcementOf(whole)).toContain("Every page is a scanned image with no text layer; call ocr with that path");
  });

  it("removes a document taken back, file and row, and clears a conversation's rows", async () => {
    const document = await store.add("conv-1", { fileName: "a.txt", mimeType: "text/plain", bytes: Buffer.from("a") });
    expect(store.remove("conv-1", document.id)).toBe(true);
    expect(readdirSync(join(root, "conv-1", "attachments"))).toEqual([]);
    expect(store.remove("conv-1", document.id)).toBe(false);
    expect(store.remove("conv-1", "not-an-id")).toBe(false);
    await store.add("conv-1", { fileName: "b.txt", mimeType: "text/plain", bytes: Buffer.from("b") });
    expect(store.clearConversation("conv-1")).toBe(1);
    expect(store.list("conv-1")).toEqual([]);
  });

  it("gives a second document with the same name its own file, and a resend the same one", async () => {
    mkdirSync(join(root, "conv-1", "attachments"), { recursive: true });
    const one = await store.add("conv-1", { fileName: "a.txt", mimeType: "text/plain", bytes: Buffer.from("first") });
    const same = await store.add("conv-1", { fileName: "a.txt", mimeType: "text/plain", bytes: Buffer.from("first") });
    const other = await store.add("conv-1", { fileName: "a.txt", mimeType: "text/plain", bytes: Buffer.from("second") });
    expect(same.path).toBe(one.path);
    expect(other.fileName).toBe("a-2.txt");
  });
});

describe("the documents route", () => {
  let db: StudioDatabase;
  let root: string;
  let app: Hono<AdmissionEnv>;
  let session: ReturnType<typeof createAdmissionSession>;
  let homeBefore: string | undefined;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    root = mkdtempSync(join(tmpdir(), "studio-docs-route-"));
    homeBefore = process.env.PROJECT_STUDIO_HOME;
    process.env.PROJECT_STUDIO_HOME = root;
    session = createAdmissionSession();
    app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/conversations", createConversationRoutes({ conversations: new ConversationStore(db), database: db }));
  });

  afterEach(() => {
    if (homeBefore === undefined) delete process.env.PROJECT_STUDIO_HOME;
    else process.env.PROJECT_STUDIO_HOME = homeBefore;
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const request = (path: string, init: RequestInit = {}) =>
    app.request(`http://harness.test${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${session.credential}` },
    });

  it("takes the file as base64 in JSON and answers what the chip shows", async () => {
    const posted = await request("/api/conversations/conv-9/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "Résumé.pdf",
        mimeType: "application/pdf",
        data: `data:application/pdf;base64,${pdfOf(["Career so far, in enough words to count"]).toString("base64")}`,
      }),
    });
    expect(posted.status).toBe(201);
    const { document } = (await posted.json()) as { document: Record<string, unknown> };
    expect(document.fileName).toBe("Résumé.pdf");
    expect(document.pageCount).toBe(1);
    expect(document.announced).toBe(false);
    expect("path" in document).toBe(false);
    expect("inlineText" in document).toBe(false);

    const listed = await request("/api/conversations/conv-9/documents");
    expect(((await listed.json()) as { documents: unknown[] }).documents).toHaveLength(1);

    const removed = await request(`/api/conversations/conv-9/documents/${String(document.id)}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect((await request(`/api/conversations/conv-9/documents/${String(document.id)}`, { method: "DELETE" })).status).toBe(404);
  });

  it("refuses a body outside the contract, and a file it cannot read, with the sentence", async () => {
    const unnamed = await request("/api/conversations/conv-9/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mimeType: "text/plain", data: "aGVsbG8=" }),
    });
    expect(unnamed.status).toBe(400);
    const broken = await request("/api/conversations/conv-9/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "a.pdf", mimeType: "application/pdf", data: Buffer.from("not a pdf").toString("base64") }),
    });
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as { error: string }).error).toContain("could not be opened");
  });
});
