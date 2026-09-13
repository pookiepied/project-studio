import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { googleListing } from "../../src/gateway/catalog/google-media.js";
import {
  initializeObservability,
  shutdownObservability,
} from "../../src/observability/index.js";

/**
 * Google's live listing, against a stand-in speaking its documented shape on
 * a real loopback socket - the connection's own base URL, which already
 * carries the version, so the read is `/models` beside it. What is pinned:
 * the two classifications the plan names (predictLongRunning, the -image
 * ids under generateContent), the `models/` prefix stripped so the catalogue
 * meets the declared catalog's spelling, the paged read following
 * `nextPageToken`, the `x-goog-api-key` header, and the wedged token
 * stopping at the ceiling.
 */

interface SeenCall {
  readonly authorization: string | undefined;
}

let standIn: Server;
let port = 0;
let seen: SeenCall[];
/** What each page answers, keyed by the query exactly as the vendor spells it. */
let pages: ReadonlyMap<string, string>;
let written: string[];

function gemini(
  name: string,
  methods: readonly string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { name, supportedGenerationMethods: methods, ...extra };
}

beforeEach(async () => {
  seen = [];
  pages = new Map();
  written = [];
  initializeObservability({ exporter: "memory", deploymentEnvironment: "test" });
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  };
  processStash = original;
  standIn = createServer((request, response) => {
    const key = request.headers["x-goog-api-key"];
    seen.push({ authorization: Array.isArray(key) ? key[0] : key });
    const answer = pages.get(request.url ?? "");
    if (answer === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: 404, message: "nothing staged" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(answer);
  });
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  port = (standIn.address() as AddressInfo).port;
});

let processStash: typeof process.stdout.write;

afterEach(async () => {
  googleListing.forget();
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

describe("Google's live listing", () => {
  it("classifies by the vendor's own words, strips the id's prefix, and follows the vendor's pages", async () => {
    pages = new Map([
      [
        "/models?pageSize=1000",
        JSON.stringify({
          models: [
            // Video: the long-running operation the adapter already drives.
            gemini("models/veo-3.1-generate-preview", ["predictLongRunning"], {
              displayName: "Veo 3.1",
            }),
            // Image: generateContent, and the id spells the pictures.
            gemini("models/gemini-3.1-flash-image", ["generateContent"], {
              displayName: "Gemini 3.1 Flash Image",
            }),
            // Chat: the language gateway's business, counted.
            gemini("models/gemini-3.1-flash", ["generateContent"]),
            // TTS: declared, where the plan keeps it.
            gemini("models/gemini-3.1-flash-tts-preview", ["generateContent"]),
          ],
          nextPageToken: "T1",
        }),
      ],
      [
        "/models?pageSize=1000&pageToken=T1",
        JSON.stringify({
          models: [
            // The prefix stripped: this is the id the declared catalog uses,
            // which is how the join will meet it.
            gemini("models/veo-3.1-fast-generate-preview", ["predictLongRunning"]),
            gemini("models/gemini-embedding-001", ["embedContent"]),
          ],
        }),
      ],
    ]);

    const models = await googleListing.models(origin(), "the-g-key");

    expect(seen).toHaveLength(2);
    expect(seen[0]?.authorization).toBe("the-g-key");
    expect(seen[1]?.authorization).toBe("the-g-key");

    const byId = new Map(models.map((model) => [model.modelId, model]));
    expect(byId.get("veo-3.1-generate-preview")?.capability.videoGeneration).toBe("supported");
    expect(byId.get("veo-3.1-generate-preview")?.shape).toBe("poll");
    expect(byId.get("gemini-3.1-flash-image")?.capability.imageGeneration).toBe("supported");
    expect(byId.get("gemini-3.1-flash-image")?.capability.imageEditing).toBe("supported");
    expect(byId.get("gemini-3.1-flash-image")?.capability.vision).toBe("supported");
    expect(byId.get("gemini-3.1-flash-image")?.displayName).toBe("Gemini 3.1 Flash Image");
    expect(byId.get("gemini-3.1-flash-image")?.shape).toBe("sync");
    expect(byId.get("veo-3.1-fast-generate-preview")?.capability.videoGeneration).toBe("supported");

    // Chat, TTS and embeddings ride the declared catalog; here they are the
    // number the read counted.
    expect(models).toHaveLength(3);
    const line = loggedLines().find((fields) =>
      (fields["msg"] ?? fields["message"])?.toString().includes("Google answered its listing"),
    );
    expect(line).toBeDefined();
    expect(line?.["kept"]).toBe(3);
    expect(line?.["dropped"]).toBe(3);
  });

  it("stops at the ceiling when a wedged nextPageToken would read forever, and keeps what it gathered", async () => {
    pages = new Map([
      [
        "/models?pageSize=1000",
        JSON.stringify({
          models: [gemini("models/veo-3.1-generate-preview", ["predictLongRunning"])],
          nextPageToken: "wedge",
        }),
      ],
      [
        "/models?pageSize=1000&pageToken=wedge",
        JSON.stringify({
          models: [gemini("models/veo-3.1-fast-generate-preview", ["predictLongRunning"])],
          nextPageToken: "wedge",
        }),
      ],
    ]);

    const models = await googleListing.models(origin(), "the-g-key");

    // Ten questions, not an evening; the video models of every page, kept.
    expect(seen).toHaveLength(10);
    expect(models).toHaveLength(10);
    expect(new Set(models.map((model) => model.modelId)).size).toBe(2);
  });
});
