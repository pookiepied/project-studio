import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { CapabilityResolver } from "../../src/gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import {
  pagesOfTranscript,
  transcriptionInstruction,
} from "../../src/gateway/media/adapters/document-transcript.js";
import { googleMedia } from "../../src/gateway/media/adapters/google.js";
import { mistralMedia } from "../../src/gateway/media/adapters/mistral.js";
import { openaiMedia } from "../../src/gateway/media/adapters/openai.js";
import { openrouterMedia } from "../../src/gateway/media/adapters/openrouter.js";
import type { DriverEndpoint } from "../../src/gateway/media/drivers/types.js";
import { MediaService } from "../../src/gateway/media/service.js";
import { capabilityFromPiModel } from "../../src/gateway/language/local/catalog.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The document-reading slot: the four adapters that read a file as pages -
 * one OCR engine, three vision models behind the shared transcription
 * instruction - against stand-ins on a loopback socket, the cut of a prose
 * answer into pages, and the service dispatching by the connection's wire.
 */

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
}

interface StandIn {
  server: Server;
  port: number;
  readonly seen: Seen[];
  answers: Map<string, (seen: Seen) => { status: number; type: string; body: Buffer | string }>;
}

let standIn: StandIn;

async function startStandIn(): Promise<StandIn> {
  const state: StandIn = { server: undefined as unknown as Server, port: 0, seen: [], answers: new Map() };
  state.server = createServer((request, response) => {
    const received: Buffer[] = [];
    request.on("data", (chunk: Buffer) => received.push(chunk));
    request.on("end", () => {
      const seen: Seen = {
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(received),
      };
      state.seen.push(seen);
      const answer = state.answers.get(seen.path.split("?")[0] ?? "");
      if (answer === undefined) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: `nothing staged for ${seen.path}` } }));
        return;
      }
      const { status, type, body } = answer(seen);
      response.writeHead(status, { "content-type": type });
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  state.port = (state.server.address() as AddressInfo).port;
  return state;
}

function base(): string {
  return `http://127.0.0.1:${String(standIn.port)}/v1`;
}

function endpoint(credential: string): DriverEndpoint {
  return { baseUrl: base(), credential };
}

function json(value: unknown, status = 200) {
  return () => ({ status, type: "application/json", body: JSON.stringify(value) });
}

function sentJson(seen: Seen | undefined): Record<string, unknown> {
  if (seen === undefined) throw new Error("nothing was sent");
  return JSON.parse(seen.body.toString("utf8")) as Record<string, unknown>;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from(PDF).toString("base64")}`;
const TWO_PAGES = "<!-- page 3 -->\n# Chapter one\n\nText of three.\n<!-- page 4 -->\nText of four.";

beforeEach(async () => {
  standIn = await startStandIn();
});

afterEach(() => {
  standIn.server.closeAllConnections();
  standIn.server.close();
});

describe("the shared transcription", () => {
  it("asks for every page, or for the pages named, with the marker the cut reads", () => {
    expect(transcriptionInstruction(undefined)).toContain("every page");
    expect(transcriptionInstruction([3, 4])).toContain("only pages 3, 4, skipping the others");
    expect(transcriptionInstruction([7])).toContain("only page 7");
    expect(transcriptionInstruction([7])).toContain("<!-- page N -->");
  });

  it("cuts an answer at its page markers, keeping the number each page carries", () => {
    expect(pagesOfTranscript(TWO_PAGES, [3, 4])).toEqual([
      { number: 3, markdown: "# Chapter one\n\nText of three." },
      { number: 4, markdown: "Text of four." },
    ]);
  });

  it("keeps an unmarked answer as one page, numbered as the first page asked for", () => {
    expect(pagesOfTranscript("just the text", [5])).toEqual([{ number: 5, markdown: "just the text" }]);
    expect(pagesOfTranscript("just the text", undefined)).toEqual([{ number: 1, markdown: "just the text" }]);
    expect(pagesOfTranscript("   ", [5])).toEqual([]);
  });
});

describe("Mistral OCR", () => {
  it("posts the document as a data URL to /ocr and shifts the vendor's page index to one-based", async () => {
    standIn.answers.set(
      "/v1/ocr",
      json({
        pages: [
          { index: 2, markdown: "# Three\n", images: [] },
          { index: 3, markdown: "Four", images: [] },
        ],
        model: "mistral-ocr-latest",
      }),
    );
    const result = await mistralMedia.readDocument?.(
      { bytes: PDF, mimeType: "application/pdf", fileName: "scan.pdf", modelId: "mistral-ocr-latest", pages: [3, 4] },
      endpoint("ms-key-1"),
    );
    expect(result).toEqual({ pages: [{ number: 3, markdown: "# Three" }, { number: 4, markdown: "Four" }] });
    const seen = standIn.seen[0];
    expect(seen?.headers.authorization).toBe("Bearer ms-key-1");
    expect(sentJson(seen)).toEqual({
      model: "mistral-ocr-latest",
      document: { type: "document_url", document_url: PDF_DATA_URL, document_name: "scan.pdf" },
      pages: [2, 3],
    });
  });

  it("sends a picture of a page as image_url", async () => {
    standIn.answers.set("/v1/ocr", json({ pages: [{ index: 0, markdown: "receipt" }] }));
    await mistralMedia.readDocument?.(
      { bytes: new Uint8Array([1]), mimeType: "image/png", fileName: "page.png", modelId: "mistral-ocr-latest" },
      endpoint("k"),
    );
    const sent = sentJson(standIn.seen[0]);
    expect(sent.document).toEqual({ type: "image_url", image_url: "data:image/png;base64,AQ==" });
    expect("pages" in sent).toBe(false);
  });

  it("relays a refusal with Mistral's sentence, and refuses a file over its ceiling before the wire", async () => {
    standIn.answers.set("/v1/ocr", json({ message: "Unauthorized" }, 401));
    await expect(
      mistralMedia.readDocument?.({ bytes: PDF, mimeType: "application/pdf", fileName: "a.pdf", modelId: "m" }, endpoint("k")),
    ).rejects.toMatchObject({ kind: "provider-refused", message: expect.stringContaining("Unauthorized") });
    await expect(
      mistralMedia.readDocument?.(
        { bytes: new Uint8Array(50 * 1024 * 1024 + 1), mimeType: "application/pdf", fileName: "a.pdf", modelId: "m" },
        endpoint("k"),
      ),
    ).rejects.toMatchObject({ kind: "document-too-large" });
    expect(standIn.seen).toHaveLength(1);
  });
});

describe("the vision models behind the shared instruction", () => {
  it("OpenAI: an input_file beside the instruction on /responses, the output text cut into pages", async () => {
    standIn.answers.set(
      "/v1/responses",
      json({ output: [{ type: "message", content: [{ type: "output_text", text: TWO_PAGES }] }] }),
    );
    const result = await openaiMedia.readDocument?.(
      { bytes: PDF, mimeType: "application/pdf", fileName: "scan.pdf", modelId: "gpt-5", pages: [3, 4] },
      endpoint("sk-1"),
    );
    expect(result?.pages.map((page) => page.number)).toEqual([3, 4]);
    const sent = sentJson(standIn.seen[0]);
    expect(sent.model).toBe("gpt-5");
    const content = (sent.input as { content: Record<string, unknown>[] }[])[0]?.content ?? [];
    expect(content[0]).toEqual({ type: "input_file", filename: "scan.pdf", file_data: PDF_DATA_URL });
    expect(content[1]).toMatchObject({ type: "input_text", text: expect.stringContaining("only pages 3, 4") });
  });

  it("Google: a document block on /interactions, read back from the text blocks", async () => {
    standIn.answers.set(
      "/v1/interactions",
      json({ steps: [{ content: [{ type: "text", text: TWO_PAGES }] }] }),
    );
    const result = await googleMedia.readDocument?.(
      { bytes: PDF, mimeType: "application/pdf", fileName: "scan.pdf", modelId: "gemini-3.1-pro" },
      endpoint("g-key"),
    );
    expect(result?.pages).toHaveLength(2);
    const seen = standIn.seen[0];
    expect(seen?.headers["x-goog-api-key"]).toBe("g-key");
    const input = sentJson(seen).input as Record<string, unknown>[];
    expect(input[0]).toEqual({ type: "document", data: Buffer.from(PDF).toString("base64"), mime_type: "application/pdf" });
    expect(input[1]).toMatchObject({ type: "text", text: expect.stringContaining("every page") });
  });

  it("OpenRouter: a file part on /chat/completions, the first choice's content cut into pages", async () => {
    standIn.answers.set(
      "/v1/chat/completions",
      json({ choices: [{ message: { role: "assistant", content: TWO_PAGES } }] }),
    );
    const result = await openrouterMedia.readDocument?.(
      { bytes: PDF, mimeType: "application/pdf", fileName: "scan.pdf", modelId: "google/gemini-3.1-pro" },
      endpoint("or-key"),
    );
    expect(result?.pages.map((page) => page.markdown)).toEqual(["# Chapter one\n\nText of three.", "Text of four."]);
    const messages = sentJson(standIn.seen[0]).messages as { content: Record<string, unknown>[] }[];
    expect(messages[0]?.content[1]).toEqual({ type: "file", file: { filename: "scan.pdf", file_data: PDF_DATA_URL } });
  });

  it("refuses an answer with no text rather than answering an empty document", async () => {
    standIn.answers.set("/v1/responses", json({ output: [] }));
    await expect(
      openaiMedia.readDocument?.({ bytes: PDF, mimeType: "application/pdf", fileName: "a.pdf", modelId: "m" }, endpoint("k")),
    ).rejects.toMatchObject({ kind: "provider-refused", message: expect.stringContaining("no text") });
  });
});

describe("which language models read documents", () => {
  const model = (api: string, input: ("text" | "image")[]) =>
    ({ id: "m", name: "m", api, provider: "p", input, reasoning: false, contextWindow: 1, maxTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, baseUrl: "" }) as unknown as Parameters<typeof capabilityFromPiModel>[0];

  it("a vision model on a wire that carries a file, and no other", () => {
    expect(capabilityFromPiModel(model("openai-responses", ["text", "image"])).documentReading).toBe("supported");
    expect(capabilityFromPiModel(model("google-generative-ai", ["text", "image"])).documentReading).toBe("supported");
    expect(capabilityFromPiModel(model("openai-responses", ["text"])).documentReading).toBe("unsupported");
    expect(capabilityFromPiModel(model("anthropic-messages", ["text", "image"])).documentReading).toBe("unsupported");
  });
});

describe("the service dispatching a document by wire", () => {
  let db: StudioDatabase;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("reads through Mistral when the slot's connection serves its wire", async () => {
    standIn.answers.set("/v1/ocr", json({ pages: [{ index: 0, markdown: "one" }] }));
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    await connections.add({
      id: "mistral",
      displayName: "Mistral",
      serves: { language: "mistral-conversations", media: "mistral" },
      source: "local",
      enabled: true,
      catalogProvider: "mistral",
      baseUrl: base(),
      apiKey: "ms-key-2",
    });
    const catalog = new ModelCatalog({ db, connections });
    await catalog.setDefault("documentReading", { connectionId: "mistral", modelId: "mistral-ocr-latest" });
    const media = new MediaService({
      resolver: new CapabilityResolver({ connections, catalog, credentials }),
    });

    const read = await media.readDocument({ bytes: PDF, mimeType: "application/pdf", fileName: "a.pdf" });
    expect(read).toEqual({ pages: [{ number: 1, markdown: "one" }] });
    expect(standIn.seen[0]?.headers.authorization).toBe("Bearer ms-key-2");
    expect(sentJson(standIn.seen[0]).model).toBe("mistral-ocr-latest");
  });

  it("says which slot is unset, in the words a person reads", async () => {
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    const catalog = new ModelCatalog({ db, connections });
    const media = new MediaService({
      resolver: new CapabilityResolver({ connections, catalog, credentials }),
    });
    await expect(
      media.readDocument({ bytes: PDF, mimeType: "application/pdf", fileName: "a.pdf" }),
    ).rejects.toMatchObject({ kind: "slot-unset", message: expect.stringContaining("document reading") });
  });
});
