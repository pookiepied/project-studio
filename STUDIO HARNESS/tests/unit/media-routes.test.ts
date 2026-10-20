import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { MediaService } from "../../src/gateway/media/service.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import { CapabilityResolver } from "../../src/gateway/connections/capability-defaults.js";
import { createMediaRoutes } from "../../src/transport/http/routes/media.js";
import { ImproveError, type TextImproverPort } from "../../src/application/text-improver.js";
import {
  createAdmissionMiddleware,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";

/**
 * The media routes end to end, against a fake provider speaking the OpenAI
 * audio shape on a real loopback socket: dictation posts multipart and reads
 * `{ text }`; read-aloud posts JSON and gets bytes back, base64 on the way
 * out. The slot resolution underneath is the real provider store, so a test
 * that passes here is the same path the mic button drives.
 */

interface ProviderServer {
  server: Server;
  port: number;
  readonly bodies: Buffer[];
  readonly requests: IncomingMessage[];
  /** What the speech endpoint answers with, set per test. */
  audio: Buffer | null;
  status: number;
}

let provider: ProviderServer;
let db: StudioDatabase;
let app: Hono<AdmissionEnv>;
let session: ReturnType<typeof createAdmissionSession>;

async function startProvider(): Promise<ProviderServer> {
  const state: ProviderServer = {
    server: undefined as unknown as Server,
    port: 0,
    bodies: [],
    requests: [],
    audio: null,
    status: 200,
  };
  state.server = createServer((request, response) => {
    state.requests.push(request);
    const received: Buffer[] = [];
    request.on("data", (chunk: Buffer) => received.push(chunk));
    request.on("end", () => {
      state.bodies.push(Buffer.concat(received));
      const transcribing = (request.url ?? "").endsWith("/audio/transcriptions");
      if (state.status >= 400) {
        response.writeHead(state.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "the provider said no" } }));
        return;
      }
      if (transcribing) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ text: "hello from the wire" }));
        return;
      }
      if (state.audio === null) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "no audio staged" } }));
        return;
      }
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end(state.audio);
    });
  });
  await new Promise<void>((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  state.port = (state.server.address() as AddressInfo).port;
  return state;
}

function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(`http://harness.test${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${session.credential}`,
        "content-type": "application/json",
      },
    }),
  );
}

async function connectOpenAi(): Promise<void> {
  const credentials = new InMemoryCredentialStore();
  const connections = new ConnectionStore({ db, credentials });
  await connections.add({
    id: "openai-work",
    displayName: "Work OpenAI",
    // One key, two kinds: the audio models are the media half of the same
    // account, and a connection that served only language would not list
    // them.
    serves: { language: "openai-completions", media: "openai" },
    source: "local",
    enabled: true,
    catalogProvider: "openai",
    baseUrl: `http://127.0.0.1:${provider.port}/v1`,
    apiKey: "sk-openai-route-secret-9f27",
  });
  // The audio routes are the question, not the vendor's list: with live
  // listings on, the stand-in would see /models before the audio call.
  const catalog = new ModelCatalog({ db, connections, liveListings: false });
  await catalog.setDefault("transcription", {
    connectionId: "openai-work",
    modelId: "whisper-1",
  });
  await catalog.setDefault("speechGeneration", {
    connectionId: "openai-work",
    modelId: "tts-1",
  });
  app = compose(credentials, connections, catalog);
}

function compose(
  credentials: InMemoryCredentialStore,
  connections: ConnectionStore,
  catalog: ModelCatalog,
  improver?: TextImproverPort,
): Hono<AdmissionEnv> {
  const media = new MediaService({
    resolver: new CapabilityResolver({ connections, catalog, credentials }),
  });
  const routed = new Hono<AdmissionEnv>();
  routed.use("*", createAdmissionMiddleware(session.verifier));
  routed.route("/api/media", createMediaRoutes(media, improver === undefined ? {} : { improver }));
  return routed;
}

beforeEach(async () => {
  provider = await startProvider();
  db = openDatabase({ path: ":memory:" });
  session = createAdmissionSession();
});

afterEach(() => {
  provider.server.closeAllConnections();
  provider.server.close();
  db.close();
});

describe("media routes", () => {
  it("requires the project scope", async () => {
    const limited = createAdmissionSession({ scopes: [ADMISSION_SCOPES.PROVIDER_MANAGEMENT] });
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    const catalog = new ModelCatalog({ db, connections, liveListings: false });
    const scoped = new Hono<AdmissionEnv>();
    scoped.use("*", createAdmissionMiddleware(limited.verifier));
    scoped.route(
      "/api/media",
      createMediaRoutes(
        new MediaService({
          resolver: new CapabilityResolver({ connections, catalog, credentials }),
        }),
      ),
    );
    const response = await scoped.request("http://harness.test/api/media/transcribe", {
      method: "POST",
      headers: { authorization: `Bearer ${limited.credential}` },
    });
    expect(response.status).toBe(403);
  });

  it("refuses an unset slot before touching the wire, naming the fix", async () => {
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    const catalog = new ModelCatalog({ db, connections, liveListings: false });
    app = compose(credentials, connections, catalog);
    provider.audio = Buffer.from([0xff, 0xf3]);

    const response = await authorized("/api/media/transcribe", {
      method: "POST",
      body: JSON.stringify({
        audio: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "audio/webm",
      }),
    });

    expect(response.status).toBe(502);
    const body = JSON.parse(await response.text()) as { code: string; error: string };
    expect(body.code).toBe("media.slot-unset");
    expect(body.error).toContain("Settings");
    expect(provider.requests).toHaveLength(0);
  });

  it("transcribes: the slot's model rides a real multipart upload, text comes back", async () => {
    await connectOpenAi();
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);

    const response = await authorized("/api/media/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio: audio.toString("base64"), mimeType: "audio/webm" }),
    });

    expect(response.status).toBe(200);
    expect((JSON.parse(await response.text()) as { text: string }).text).toBe(
      "hello from the wire",
    );

    // The upload is genuinely multipart: the slot's model, the recorded
    // container's mime type, and the audio bytes verbatim.
    const request = provider.requests[0];
    expect(request?.url).toBe("/v1/audio/transcriptions");
    const sent = provider.bodies[0]?.toString("latin1") ?? "";
    expect(sent).toContain('name="model"');
    expect(sent).toContain("whisper-1");
    expect(sent).toContain('filename="dictation.webm"');
    expect(sent).toContain("audio/webm");
    const headerEnd = sent.indexOf("\r\n\r\n") + 4;
    const fileStart = sent.indexOf(Buffer.from(audio).toString("latin1"), headerEnd);
    expect(fileStart).toBeGreaterThan(headerEnd);
    // The key presented itself as a bearer and appears nowhere else.
    expect(request?.headers.authorization).toBe("Bearer sk-openai-route-secret-9f27");
    expect(sent).not.toContain("sk-openai-route-secret-9f27");
  });

  it("keeps WAV bytes, MIME type and filename consistent through the transcription route", async () => {
    await connectOpenAi();
    const audio = Buffer.from("RIFF-test-WAVE", "ascii");
    const response = await authorized("/api/media/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio: audio.toString("base64"), mimeType: "audio/wav" }),
    });
    expect(response.status).toBe(200);
    const sent = provider.bodies[0]?.toString("latin1") ?? "";
    expect(sent).toContain('filename="dictation.wav"');
    expect(sent).toContain("Content-Type: audio/wav");
    expect(sent).toContain(audio.toString("latin1"));
    expect(sent).not.toContain("dictation.webm");
  });

  it("speaks: JSON in, audio bytes out, base64 on the way home", async () => {
    await connectOpenAi();
    provider.audio = Buffer.from([0xff, 0xf3, 0x40, 0xc4, 0x00, 0x00, 0x00, 0x01]);

    const response = await authorized("/api/media/speech", {
      method: "POST",
      body: JSON.stringify({ text: "Good morning." }),
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as { audio: string; mimeType: string };
    expect(body.mimeType).toBe("audio/mpeg");
    expect(Buffer.from(body.audio, "base64").equals(provider.audio)).toBe(true);

    const request = provider.requests[0];
    expect(request?.url).toBe("/v1/audio/speech");
    const sent = JSON.parse(provider.bodies[0]?.toString() ?? "{}") as {
      model: string;
      input: string;
      voice: string;
    };
    expect(sent.model).toBe("tts-1");
    expect(sent.input).toBe("Good morning.");
    expect(sent.voice).toBe("alloy");
  });

  it("answers a malformed body with 400 and a sentence", async () => {
    await connectOpenAi();
    const response = await authorized("/api/media/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio: 42 }),
    });
    expect(response.status).toBe(400);
    const body = JSON.parse(await response.text()) as { error: string };
    expect(body.error).toContain("audio");
  });

  it("relays a provider refusal with the provider's own sentence, not its key", async () => {
    await connectOpenAi();
    provider.audio = null;
    provider.status = 401;

    const response = await authorized("/api/media/speech", {
      method: "POST",
      body: JSON.stringify({ text: "Good morning." }),
    });

    expect(response.status).toBe(502);
    const body = JSON.parse(await response.text()) as { code: string; error: string };
    expect(body.code).toBe("media.provider-refused");
    expect(body.error).toContain("the provider said no");
  });

  it("refuses text too long for one speech call before any socket opens", async () => {
    await connectOpenAi();
    const response = await authorized("/api/media/speech", {
      method: "POST",
      body: JSON.stringify({ text: "a".repeat(5000) }),
    });
    expect(response.status).toBe(502);
    const body = JSON.parse(await response.text()) as { error: string };
    expect(body.error).toContain("4096");
    expect(provider.requests).toHaveLength(0);
  });
});

describe("POST /api/media/improve", () => {
  async function composeWith(improver?: TextImproverPort): Promise<void> {
    const credentials = new InMemoryCredentialStore();
    const connections = new ConnectionStore({ db, credentials });
    const catalog = new ModelCatalog({ db, connections, liveListings: false });
    app = compose(credentials, connections, catalog, improver);
    await Promise.resolve();
  }

  it("hands the passage to the improver and answers its text", async () => {
    const asked: string[] = [];
    await composeWith({
      improve: async (text) => {
        asked.push(text);
        return "Tidied.";
      },
    });
    const response = await authorized("/api/media/improve", {
      method: "POST",
      body: JSON.stringify({ text: "um tidied" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Tidied." });
    expect(asked).toEqual(["um tidied"]);
  });

  it("is a 400 for a body outside the shape, and for input the improver refuses", async () => {
    await composeWith({
      improve: () => Promise.reject(new ImproveError("bad-input", "There is nothing to improve.")),
    });
    const shapeless = await authorized("/api/media/improve", { method: "POST", body: JSON.stringify({}) });
    expect(shapeless.status).toBe(400);
    const refused = await authorized("/api/media/improve", {
      method: "POST",
      body: JSON.stringify({ text: "   " }),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("nothing to improve");
  });

  it("is a 502 with the improver's sentence when the model failed", async () => {
    await composeWith({
      improve: () => Promise.reject(new ImproveError("model-failed", "The model did not finish.")),
    });
    const response = await authorized("/api/media/improve", {
      method: "POST",
      body: JSON.stringify({ text: "x" }),
    });
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe("The model did not finish.");
  });

  it("says so when no improver is wired", async () => {
    await composeWith(undefined);
    const response = await authorized("/api/media/improve", {
      method: "POST",
      body: JSON.stringify({ text: "x" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("Nothing in this harness improves");
  });
});
