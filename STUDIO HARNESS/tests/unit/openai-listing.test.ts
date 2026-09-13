import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openaiListing } from "../../src/gateway/catalog/openai-media.js";
import {
  initializeObservability,
  shutdownObservability,
} from "../../src/observability/index.js";

/**
 * OpenAI's live listing, against a stand-in speaking its documented shape on
 * a real loopback socket - the connection's own base URL, the bearer header
 * the chat half already uses. What is pinned: the id patterns as the whole
 * classification, the chat models' count, the families' shapes, and the
 * keyless read that answers nothing and then asks again.
 */

interface SeenCall {
  readonly authorization: string | undefined;
}

let standIn: Server;
let port = 0;
let seen: SeenCall[];
let answers: { readonly status: number; readonly body: string }[];
let written: string[];

beforeEach(async () => {
  seen = [];
  answers = [];
  written = [];
  initializeObservability({ exporter: "memory", deploymentEnvironment: "test" });
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  };
  processStash = original;
  standIn = createServer((request, response) => {
    const authorization = request.headers.authorization;
    seen.push({ authorization: Array.isArray(authorization) ? authorization[0] : authorization });
    const answer = answers.shift();
    if (answer === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "nothing staged" } }));
      return;
    }
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(answer.body);
  });
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  port = (standIn.address() as AddressInfo).port;
});

let processStash: typeof process.stdout.write;

afterEach(async () => {
  openaiListing.forget();
  standIn.closeAllConnections();
  standIn.close();
  process.stdout.write = processStash;
  await shutdownObservability();
});

function origin(): string {
  return `http://127.0.0.1:${String(port)}`;
}

function loggedLines(): readonly Record<string, unknown>[] {
  return written
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("OpenAI's live listing", () => {
  it("reads the family off the id, and counts the chat models the language gateway already answers", async () => {
    answers = [
      {
        status: 200,
        body: JSON.stringify({
          object: "list",
          data: [
            { id: "gpt-5.2", object: "model" },
            { id: "gpt-4.1-mini", object: "model" },
            { id: "gpt-image-2", object: "model" },
            { id: "gpt-4o-mini-tts", object: "model" },
            { id: "tts-1", object: "model" },
            { id: "gpt-4o-mini-transcribe", object: "model" },
            { id: "whisper-1", object: "model" },
            { id: "text-embedding-3-small", object: "model" },
          ],
        }),
      },
    ];

    const models = await openaiListing.models(origin(), "the-oa-key");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBe("Bearer the-oa-key");

    const byId = new Map(models.map((model) => [model.modelId, model]));
    // The paint family paints, edits, and sees - the trio the wire earns.
    expect(byId.get("gpt-image-2")?.capability.imageGeneration).toBe("supported");
    expect(byId.get("gpt-image-2")?.capability.imageEditing).toBe("supported");
    expect(byId.get("gpt-image-2")?.capability.vision).toBe("supported");
    expect(byId.get("gpt-4o-mini-tts")?.capability.speechGeneration).toBe("supported");
    expect(byId.get("tts-1")?.capability.speechGeneration).toBe("supported");
    expect(byId.get("gpt-4o-mini-transcribe")?.capability.transcription).toBe("supported");
    expect(byId.get("whisper-1")?.capability.transcription).toBe("supported");
    expect(byId.get("text-embedding-3-small")?.capability.embeddings).toBe("supported");
    // And every one of them stays out of the composer: these are not chat.
    expect(byId.get("gpt-4o-mini-tts")?.capability.textGeneration).toBe("unsupported");
    expect(models.every((model) => model.shape === "sync")).toBe(true);

    // Six kept, two chat models counted - the language gateway's business.
    expect(models).toHaveLength(6);
    const line = loggedLines().find((fields) =>
      (fields["msg"] ?? fields["message"])?.toString().includes("OpenAI answered its listing"),
    );
    expect(line).toBeDefined();
    expect(line?.["kept"]).toBe(6);
    expect(line?.["dropped"]).toBe(2);
  });

  it("answers nothing when the keyless read is refused, and asks again with the key", async () => {
    answers = [
      { status: 401, body: JSON.stringify({ error: { message: "Missing bearer authentication in header" } }) },
      {
        status: 200,
        body: JSON.stringify({ object: "list", data: [{ id: "gpt-image-2", object: "model" }] }),
      },
    ];

    expect(await openaiListing.models(origin(), undefined)).toEqual([]);
    expect(seen[0]?.authorization).toBeUndefined();

    const models = await openaiListing.models(origin(), "the-oa-key");
    expect(models).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.authorization).toBe("Bearer the-oa-key");
  });
});
