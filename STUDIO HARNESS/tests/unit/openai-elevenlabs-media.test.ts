import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { CapabilityResolver } from "../../src/gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { elevenlabsMedia } from "../../src/gateway/media/adapters/elevenlabs.js";
import { openaiMedia } from "../../src/gateway/media/adapters/openai.js";
import type { DriverEndpoint } from "../../src/gateway/media/drivers/types.js";
import { MediaService } from "../../src/gateway/media/service.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The OpenAI image half and the ElevenLabs adapter, against stand-ins on a
 * loopback socket - the wire each speaks, and the bytes that come back -
 * and the service dispatching read-aloud to ElevenLabs by the connection's
 * media wire, where a language-shaped fallback used to refuse it.
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

beforeEach(async () => {
  standIn = await startStandIn();
});

afterEach(() => {
  standIn.server.closeAllConnections();
  standIn.server.close();
});

describe("OpenAI images", () => {
  it("generates through /images/generations and decodes base64 in the vendor's output format", async () => {
    standIn.answers.set(
      "/v1/images/generations",
      json({ created: 1, output_format: "webp", data: [{ b64_json: Buffer.from([0x52, 0x49]).toString("base64") }] }),
    );
    const generation = await openaiMedia.generateImage?.(
      { prompt: "a red bicycle", modelId: "gpt-image-2", size: "1024x1024", count: 1 },
      endpoint("sk-openai-1"),
    );
    if (generation?.shape !== "sync") throw new Error("expected sync");
    const [only] = await generation.result;
    expect(only?.mimeType).toBe("image/webp");
    expect([...(only?.bytes ?? [])]).toEqual([0x52, 0x49]);
    const seen = standIn.seen[0];
    expect(seen?.headers.authorization).toBe("Bearer sk-openai-1");
    expect(sentJson(seen)).toEqual({ model: "gpt-image-2", prompt: "a red bicycle", size: "1024x1024", n: 1 });
  });

  it("edits through /images/edits with the input images as data URLs", async () => {
    standIn.answers.set("/v1/images/edits", json({ data: [{ b64_json: "AA==" }] }));
    const generation = await openaiMedia.generateImage?.(
      {
        prompt: "make the sky green",
        modelId: "gpt-image-2.5-flare",
        inputImages: [{ bytes: new Uint8Array([1, 2]), mimeType: "image/png" }],
      },
      endpoint("sk-openai-1"),
    );
    if (generation?.shape !== "sync") throw new Error("expected sync");
    const [only] = await generation.result;
    // No output_format in the answer: png, the model's default.
    expect(only?.mimeType).toBe("image/png");
    expect(sentJson(standIn.seen[0])).toEqual({
      model: "gpt-image-2.5-flare",
      prompt: "make the sky green",
      images: [{ image_url: `data:image/png;base64,${Buffer.from([1, 2]).toString("base64")}` }],
    });
  });

  it("relays a refusal with OpenAI's sentence", async () => {
    standIn.answers.set("/v1/images/generations", json({ error: { message: "organization not verified" } }, 403));
    const generation = await openaiMedia.generateImage?.({ prompt: "x", modelId: "m" }, endpoint("k"));
    if (generation?.shape !== "sync") throw new Error("expected sync");
    await expect(generation.result).rejects.toMatchObject({
      kind: "provider-refused",
      message: expect.stringContaining("organization not verified"),
    });
  });

  it("carries the audio drivers and no video", () => {
    expect("speak" in openaiMedia && "transcribe" in openaiMedia).toBe(true);
    expect("generateVideo" in openaiMedia).toBe(false);
  });
});

describe("ElevenLabs", () => {
  it("speaks through the voice's path with the key in xi-api-key, mp3 back", async () => {
    standIn.answers.set("/v1/text-to-speech/voice-7", () => ({
      status: 200,
      type: "audio/mpeg",
      body: Buffer.from([0xff, 0xfb]),
    }));
    const result = await elevenlabsMedia.speak?.(
      { text: "Good morning.", modelId: "eleven_v3", voiceId: "voice-7" },
      endpoint("xi-key-1"),
    );
    expect(result).toEqual({ audio: Buffer.from([0xff, 0xfb]).toString("base64"), mimeType: "audio/mpeg" });
    const seen = standIn.seen[0];
    expect(seen?.path).toBe("/v1/text-to-speech/voice-7?output_format=mp3_44100_128");
    expect(seen?.headers["xi-api-key"]).toBe("xi-key-1");
    expect(seen?.headers.authorization).toBeUndefined();
    expect(sentJson(seen)).toEqual({ text: "Good morning.", model_id: "eleven_v3" });
  });

  it("speaks with ElevenLabs's premade voice when none was chosen", async () => {
    standIn.answers.set("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM", () => ({
      status: 200,
      type: "audio/mpeg",
      body: Buffer.from([1]),
    }));
    await elevenlabsMedia.speak?.({ text: "x", modelId: "eleven_flash_v2_5" }, endpoint("k"));
    expect(standIn.seen[0]?.path.startsWith("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM")).toBe(true);
  });

  it("transcribes through Scribe as multipart, and reads the text back", async () => {
    standIn.answers.set("/v1/speech-to-text", json({ language_code: "en", text: "hello from scribe", words: [] }));
    const result = await elevenlabsMedia.transcribe?.(
      { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm", modelId: "scribe_v2" },
      endpoint("xi-key-1"),
    );
    expect(result).toEqual({ text: "hello from scribe" });
    const seen = standIn.seen[0];
    expect(seen?.headers["content-type"]).toContain("multipart/form-data");
    expect(seen?.headers["xi-api-key"]).toBe("xi-key-1");
    const body = seen?.body.toString("latin1") ?? "";
    expect(body).toContain('name="model_id"');
    expect(body).toContain("scribe_v2");
    expect(body).toContain('name="file"');
  });

  it("relays a refusal in ElevenLabs's detail shape", async () => {
    standIn.answers.set("/v1/speech-to-text", json({ detail: { status: "invalid_api_key", message: "key rejected" } }, 401));
    await expect(
      elevenlabsMedia.transcribe?.({ audio: new Uint8Array([1]), mimeType: "audio/webm", modelId: "scribe_v2" }, endpoint("k")),
    ).rejects.toMatchObject({ kind: "provider-refused", message: expect.stringContaining("key rejected") });
  });
});

describe("the service dispatching audio by wire", () => {
  let db: StudioDatabase;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("reads aloud through ElevenLabs when the slot's connection serves its wire", async () => {
    standIn.answers.set("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM", () => ({
      status: 200,
      type: "audio/mpeg",
      body: Buffer.from([7]),
    }));
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    await connections.add({
      id: "elevenlabs",
      displayName: "ElevenLabs",
      serves: { media: "elevenlabs" },
      source: "local",
      enabled: true,
      catalogProvider: "elevenlabs",
      baseUrl: base(),
      apiKey: "xi-key-2",
    });
    const catalog = new ModelCatalog({ db, connections });
    await catalog.setDefault("speechGeneration", { connectionId: "elevenlabs", modelId: "eleven_v3" });
    const media = new MediaService({
      resolver: new CapabilityResolver({ connections, catalog, credentials }),
    });

    const spoken = await media.speak({ text: "Good morning." });
    expect(spoken).toEqual({ audio: Buffer.from([7]).toString("base64"), mimeType: "audio/mpeg" });
    expect(standIn.seen[0]?.headers["xi-api-key"]).toBe("xi-key-2");
  });
});
