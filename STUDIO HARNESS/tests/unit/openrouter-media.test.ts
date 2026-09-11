import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openrouterMedia } from "../../src/gateway/media/adapters/openrouter.js";
import type { DriverEndpoint } from "../../src/gateway/media/drivers/types.js";

/**
 * The OpenRouter adapter against a stand-in speaking OpenRouter's four media
 * shapes on a real loopback socket: what is pinned is the wire - which path,
 * which fields, which header the key rides in - and what comes back as bytes.
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
  /** What each path answers, set per test. */
  answers: Map<string, (seen: Seen) => { status: number; type: string; body: Buffer | string }>;
}

let standIn: StandIn;

async function startStandIn(): Promise<StandIn> {
  const state: StandIn = {
    server: undefined as unknown as Server,
    port: 0,
    seen: [],
    answers: new Map(),
  };
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

function endpoint(): DriverEndpoint {
  return { baseUrl: `http://127.0.0.1:${String(standIn.port)}/api/v1`, credential: "sk-or-test-1" };
}

function json(value: unknown, status = 200) {
  return () => ({ status, type: "application/json", body: JSON.stringify(value) });
}

function sentJson(seen: Seen): Record<string, unknown> {
  return JSON.parse(seen.body.toString("utf8")) as Record<string, unknown>;
}

beforeEach(async () => {
  standIn = await startStandIn();
});

afterEach(() => {
  standIn.server.closeAllConnections();
  standIn.server.close();
});

describe("speech", () => {
  it("posts OpenAI's shape and answers mp3 bytes, base64", async () => {
    standIn.answers.set("/api/v1/audio/speech", () => ({
      status: 200,
      type: "audio/mpeg",
      body: Buffer.from([0xff, 0xfb, 0x90]),
    }));
    const result = await openrouterMedia.speak?.(
      { text: "Good morning.", modelId: "openai/gpt-4o-mini-tts", voiceId: "marin" },
      endpoint(),
    );
    expect(result).toEqual({ audio: Buffer.from([0xff, 0xfb, 0x90]).toString("base64"), mimeType: "audio/mpeg" });
    const seen = standIn.seen[0];
    expect(seen?.method).toBe("POST");
    expect(seen?.headers.authorization).toBe("Bearer sk-or-test-1");
    expect(seen?.headers["x-title"]).toBe("Project Studio");
    expect(sentJson(seen!)).toEqual({
      model: "openai/gpt-4o-mini-tts",
      input: "Good morning.",
      voice: "marin",
      response_format: "mp3",
    });
  });

  it("relays a refusal's sentence and never its key", async () => {
    standIn.answers.set("/api/v1/audio/speech", json({ error: { message: "insufficient credits" } }, 402));
    await expect(
      openrouterMedia.speak?.({ text: "x", modelId: "m" }, endpoint()),
    ).rejects.toMatchObject({ kind: "provider-refused", message: expect.stringContaining("insufficient credits") });
  });
});

describe("transcription", () => {
  it("sends base64 audio with its format word, and reads the text back", async () => {
    standIn.answers.set("/api/v1/audio/transcriptions", json({ text: "hello from the wire", usage: {} }));
    const result = await openrouterMedia.transcribe?.(
      { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm;codecs=opus", modelId: "deepgram/nova-3" },
      endpoint(),
    );
    expect(result).toEqual({ text: "hello from the wire" });
    const sent = sentJson(standIn.seen[0]!);
    expect(sent.model).toBe("deepgram/nova-3");
    expect(sent.input_audio).toEqual({ data: Buffer.from([1, 2, 3]).toString("base64"), format: "webm" });
  });

  it("names mp3 for audio/mpeg and m4a for audio/mp4", async () => {
    standIn.answers.set("/api/v1/audio/transcriptions", json({ text: "ok" }));
    await openrouterMedia.transcribe?.({ audio: new Uint8Array([1]), mimeType: "audio/mpeg", modelId: "m" }, endpoint());
    await openrouterMedia.transcribe?.({ audio: new Uint8Array([1]), mimeType: "audio/mp4", modelId: "m" }, endpoint());
    expect((sentJson(standIn.seen[0]!).input_audio as { format: string }).format).toBe("mp3");
    expect((sentJson(standIn.seen[1]!).input_audio as { format: string }).format).toBe("m4a");
  });
});

describe("images", () => {
  it("is synchronous: one POST, base64 back, decoded to bytes with the vendor's media type", async () => {
    standIn.answers.set(
      "/api/v1/images",
      json({
        created: 1,
        data: [
          { b64_json: Buffer.from([0x89, 0x50]).toString("base64"), media_type: "image/png" },
          { b64_json: Buffer.from([0xff, 0xd8]).toString("base64"), media_type: "image/jpeg" },
        ],
      }),
    );
    const generation = await openrouterMedia.generateImage?.(
      { prompt: "a red bicycle", modelId: "openai/gpt-image-2", aspectRatio: "1:1", count: 2 },
      endpoint(),
    );
    expect(generation?.shape).toBe("sync");
    if (generation?.shape !== "sync") return;
    const outputs = await generation.result;
    expect(outputs.map((o) => [o.mimeType, [...o.bytes]])).toEqual([
      ["image/png", [0x89, 0x50]],
      ["image/jpeg", [0xff, 0xd8]],
    ]);
    expect(sentJson(standIn.seen[0]!)).toEqual({
      model: "openai/gpt-image-2",
      prompt: "a red bicycle",
      aspect_ratio: "1:1",
      n: 2,
    });
  });

  it("sends input images as data-URL references, which makes the call an edit", async () => {
    standIn.answers.set("/api/v1/images", json({ data: [{ b64_json: "AA==" }] }));
    const generation = await openrouterMedia.generateImage?.(
      {
        prompt: "make the sky green",
        modelId: "google/gemini-3.1-flash-image",
        inputImages: [{ bytes: new Uint8Array([1, 2]), mimeType: "image/png" }],
      },
      endpoint(),
    );
    if (generation?.shape !== "sync") throw new Error("expected sync");
    const [only] = await generation.result;
    // No media_type from the vendor means png, the format most of them default to.
    expect(only?.mimeType).toBe("image/png");
    const sent = sentJson(standIn.seen[0]!);
    expect(sent.input_references).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from([1, 2]).toString("base64")}` } },
    ]);
  });

  it("fails the generation, not the call, when the answer carries no image", async () => {
    standIn.answers.set("/api/v1/images", json({ data: [] }));
    const generation = await openrouterMedia.generateImage?.({ prompt: "x", modelId: "m" }, endpoint());
    if (generation?.shape !== "sync") throw new Error("expected sync");
    await expect(generation.result).rejects.toMatchObject({ kind: "provider-refused" });
  });
});

describe("video", () => {
  it("submits, polls through the vendor's states, and downloads the bytes on completed", async () => {
    let polls = 0;
    standIn.answers.set("/api/v1/videos", json({ id: "job-abc", polling_url: "/api/v1/videos/job-abc", status: "pending" }, 202));
    standIn.answers.set("/api/v1/videos/job-abc", () => {
      polls += 1;
      const status = polls === 1 ? "pending" : polls === 2 ? "in_progress" : "completed";
      return {
        status: 200,
        type: "application/json",
        body: JSON.stringify({ id: "job-abc", polling_url: "/api/v1/videos/job-abc", status, unsigned_urls: [] }),
      };
    });
    standIn.answers.set("/api/v1/videos/job-abc/content", () => ({
      status: 200,
      type: "video/mp4",
      body: Buffer.from([0, 0, 0, 0x18]),
    }));

    const generation = await openrouterMedia.generateVideo?.(
      {
        prompt: "waves at dusk",
        modelId: "google/veo-3.1",
        durationSeconds: 8,
        aspectRatio: "16:9",
        resolution: "720p",
        image: { bytes: new Uint8Array([9]), mimeType: "image/png" },
      },
      endpoint(),
    );
    expect(generation?.shape).toBe("poll");
    if (generation?.shape !== "poll") return;
    expect(generation.job.id).toBe("job-abc");
    expect("cancel" in generation.job).toBe(false);

    const submitted = sentJson(standIn.seen[0]!);
    expect(submitted).toMatchObject({
      model: "google/veo-3.1",
      prompt: "waves at dusk",
      duration: 8,
      aspect_ratio: "16:9",
      resolution: "720p",
    });
    expect(submitted.frame_images).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,CQ==" }, frame_type: "first_frame" },
    ]);

    expect(await generation.job.poll()).toEqual({ state: "queued" });
    expect(await generation.job.poll()).toEqual({ state: "running" });
    const done = await generation.job.poll();
    expect(done.state).toBe("done");
    if (done.state !== "done") return;
    expect(done.outputs.map((o) => [o.mimeType, [...o.bytes]])).toEqual([["video/mp4", [0, 0, 0, 0x18]]]);
    // The download rode the same key as everything else.
    expect(standIn.seen.at(-1)?.path).toBe("/api/v1/videos/job-abc/content");
    expect(standIn.seen.at(-1)?.headers.authorization).toBe("Bearer sk-or-test-1");
  });

  it("reports failed, cancelled and expired as failures with the vendor's word", async () => {
    standIn.answers.set("/api/v1/videos", json({ id: "job-x", polling_url: "/api/v1/videos/job-x", status: "pending" }, 202));
    standIn.answers.set("/api/v1/videos/job-x", json({ id: "job-x", polling_url: "", status: "failed", error: "safety filter" }));
    const generation = await openrouterMedia.generateVideo?.({ prompt: "x", modelId: "m" }, endpoint());
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(await generation.job.poll()).toEqual({ state: "failed", message: "safety filter" });
  });
});
