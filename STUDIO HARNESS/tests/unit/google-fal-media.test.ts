import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { falMedia } from "../../src/gateway/media/adapters/fal.js";
import { googleMedia } from "../../src/gateway/media/adapters/google.js";
import type { DriverEndpoint } from "../../src/gateway/media/drivers/types.js";

/**
 * The Google and FAL adapters against stand-ins on a loopback socket: the
 * Interactions API's blocks, Veo's long-running operation, and FAL's
 * submit-status-response-cancel queue, with the bytes downloaded inside the
 * poll that saw them finished.
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

function host(): string {
  return `http://127.0.0.1:${String(standIn.port)}`;
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

describe("Google through the Interactions API", () => {
  function endpoint(): DriverEndpoint {
    return { baseUrl: `${host()}/v1beta`, credential: "g-key-1" };
  }

  it("generates an image from text, with the key in x-goog-api-key, and reads the image block", async () => {
    standIn.answers.set(
      "/v1beta/interactions",
      json({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              { type: "text", text: "Here you go." },
              { type: "image", mime_type: "image/png", data: Buffer.from([0x89, 0x50]).toString("base64") },
            ],
          },
        ],
      }),
    );
    const generation = await googleMedia.generateImage?.(
      { prompt: "a nano banana dish", modelId: "gemini-3.1-flash-image", aspectRatio: "16:9" },
      endpoint(),
    );
    if (generation?.shape !== "sync") throw new Error("expected sync");
    const [only] = await generation.result;
    expect(only?.mimeType).toBe("image/png");
    expect([...(only?.bytes ?? [])]).toEqual([0x89, 0x50]);
    const seen = standIn.seen[0];
    expect(seen?.headers["x-goog-api-key"]).toBe("g-key-1");
    expect(sentJson(seen)).toEqual({
      model: "gemini-3.1-flash-image",
      input: [{ type: "text", text: "a nano banana dish" }],
      response_format: { type: "image", aspect_ratio: "16:9" },
    });
  });

  it("edits by sending the input image as a base64 block beside the text", async () => {
    standIn.answers.set(
      "/v1beta/interactions",
      json({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: "AA==" }] }] }),
    );
    const generation = await googleMedia.generateImage?.(
      { prompt: "make it night", modelId: "gemini-3-pro-image", inputImages: [{ bytes: new Uint8Array([1]), mimeType: "image/png" }] },
      endpoint(),
    );
    if (generation?.shape !== "sync") throw new Error("expected sync");
    await generation.result;
    const sent = sentJson(standIn.seen[0]);
    expect(sent.input).toEqual([
      { type: "text", text: "make it night" },
      { type: "image", mime_type: "image/png", data: "AQ==" },
    ]);
  });

  it("speaks: audio response format, a voice, and headerless PCM given a WAV header", async () => {
    const pcm = Buffer.from([1, 0, 2, 0]);
    standIn.answers.set(
      "/v1beta/interactions",
      json({ steps: [{ type: "model_output", content: [{ type: "audio", data: pcm.toString("base64") }] }] }),
    );
    const result = await googleMedia.speak?.({ text: "Have a wonderful day!", modelId: "gemini-3.1-flash-tts-preview" }, endpoint());
    expect(result?.mimeType).toBe("audio/wav");
    const wav = Buffer.from(result?.audio ?? "", "base64");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect([...wav.subarray(44)]).toEqual([...pcm]);
    expect(sentJson(standIn.seen[0])).toMatchObject({
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Kore" }] },
    });
  });

  it("transcribes an inline audio block and joins the text blocks", async () => {
    standIn.answers.set(
      "/v1beta/interactions",
      json({ steps: [{ type: "model_output", content: [{ type: "text", text: "Hello world", annotations: [] }] }] }),
    );
    const result = await googleMedia.transcribe?.(
      { audio: new Uint8Array([9, 9]), mimeType: "audio/webm;codecs=opus", modelId: "gemini-3.5-transcribe" },
      endpoint(),
    );
    expect(result).toEqual({ text: "Hello world" });
    expect(sentJson(standIn.seen[0])).toEqual({
      model: "gemini-3.5-transcribe",
      input: [{ type: "audio", data: "CQk=", mime_type: "audio/webm" }],
    });
  });

  it("runs Veo as a long-running operation and downloads the file with the key", async () => {
    let polls = 0;
    standIn.answers.set(
      "/v1beta/models/veo-3.1-generate-preview:predictLongRunning",
      json({ name: "models/veo-3.1-generate-preview/operations/op-1" }),
    );
    standIn.answers.set("/v1beta/models/veo-3.1-generate-preview/operations/op-1", () => {
      polls += 1;
      return {
        status: 200,
        type: "application/json",
        body: JSON.stringify(
          polls < 2
            ? { name: "op-1", done: false }
            : {
                name: "op-1",
                done: true,
                response: {
                  generateVideoResponse: { generatedSamples: [{ video: { uri: `${host()}/files/v1:download` } }] },
                },
              },
        ),
      };
    });
    standIn.answers.set("/files/v1:download", () => ({ status: 200, type: "video/mp4", body: Buffer.from([0, 0, 1]) }));

    const generation = await googleMedia.generateVideo?.(
      {
        prompt: "waves",
        modelId: "veo-3.1-generate-preview",
        durationSeconds: 8,
        aspectRatio: "16:9",
        image: { bytes: new Uint8Array([7]), mimeType: "image/png" },
      },
      endpoint(),
    );
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(sentJson(standIn.seen[0])).toEqual({
      instances: [{ prompt: "waves", image: { inlineData: { mimeType: "image/png", data: "Bw==" } } }],
      parameters: { aspectRatio: "16:9", durationSeconds: "8" },
    });
    expect(await generation.job.poll()).toEqual({ state: "running" });
    const done = await generation.job.poll();
    expect(done.state).toBe("done");
    if (done.state !== "done") return;
    expect([...(done.outputs[0]?.bytes ?? [])]).toEqual([0, 0, 1]);
    expect(standIn.seen.at(-1)?.headers["x-goog-api-key"]).toBe("g-key-1");
  });

  it("reports an operation's error as the failure", async () => {
    standIn.answers.set("/v1beta/models/m:predictLongRunning", json({ name: "ops/op-2" }));
    standIn.answers.set("/v1beta/ops/op-2", json({ done: true, error: { code: 3, message: "safety filter" } }));
    const generation = await googleMedia.generateVideo?.({ prompt: "x", modelId: "m" }, endpoint());
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(await generation.job.poll()).toEqual({ state: "failed", message: "safety filter" });
  });
});

describe("FAL through the queue", () => {
  function endpoint(): DriverEndpoint {
    return { baseUrl: host(), credential: "fal-key-1" };
  }

  it("submits with the Key prefix, walks the queue, and downloads every output the result names", async () => {
    let polls = 0;
    standIn.answers.set("/fal-ai/flux-2/pro", (seen) => {
      expect(seen.headers.authorization).toBe("Key fal-key-1");
      return {
        status: 200,
        type: "application/json",
        body: JSON.stringify({
          request_id: "req-1",
          status_url: `${host()}/fal-ai/flux-2/pro/requests/req-1/status`,
          response_url: `${host()}/fal-ai/flux-2/pro/requests/req-1`,
          cancel_url: `${host()}/fal-ai/flux-2/pro/requests/req-1/cancel`,
        }),
      };
    });
    standIn.answers.set("/fal-ai/flux-2/pro/requests/req-1/status", () => {
      polls += 1;
      const body =
        polls === 1
          ? { status: "IN_QUEUE", queue_position: 2 }
          : polls === 2
            ? { status: "IN_PROGRESS", logs: [{ message: "Loading model weights..." }, { message: "Generating image..." }] }
            : { status: "COMPLETED", logs: [] };
      return { status: 200, type: "application/json", body: JSON.stringify(body) };
    });
    standIn.answers.set(
      "/fal-ai/flux-2/pro/requests/req-1",
      json({ images: [{ url: `${host()}/cdn/a.png`, content_type: "image/png" }, { url: `${host()}/cdn/b.jpg` }] }),
    );
    standIn.answers.set("/cdn/a.png", () => ({ status: 200, type: "image/png", body: Buffer.from([1]) }));
    standIn.answers.set("/cdn/b.jpg", () => ({ status: 200, type: "image/jpeg", body: Buffer.from([2]) }));

    const generation = await falMedia.generateImage?.(
      { prompt: "a sunset", modelId: "fal-ai/flux-2/pro", count: 2, inputImages: [{ bytes: new Uint8Array([5]), mimeType: "image/png" }] },
      endpoint(),
    );
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(generation.job.id).toBe("req-1");
    expect(sentJson(standIn.seen[0])).toEqual({
      prompt: "a sunset",
      num_images: 2,
      image_url: "data:image/png;base64,BQ==",
    });

    expect(await generation.job.poll()).toEqual({ state: "queued", detail: "2 ahead in the queue" });
    expect(await generation.job.poll()).toEqual({ state: "running", detail: "Generating image..." });
    const done = await generation.job.poll();
    expect(done.state).toBe("done");
    if (done.state !== "done") return;
    expect(done.outputs.map((o) => [o.mimeType, [...o.bytes]])).toEqual([
      ["image/png", [1]],
      ["image/jpeg", [2]],
    ]);
    // The status was asked with logs on, every time.
    expect(standIn.seen.filter((seen) => seen.path.includes("/status?logs=1"))).toHaveLength(3);
  });

  it("cancels with a PUT to the cancel URL", async () => {
    standIn.answers.set("/fal-ai/veo3.1", json({ request_id: "req-2", cancel_url: `${host()}/fal-ai/veo3.1/requests/req-2/cancel` }));
    standIn.answers.set("/fal-ai/veo3.1/requests/req-2/cancel", json({ status: "CANCELLATION_REQUESTED" }, 202));
    const generation = await falMedia.generateVideo?.({ prompt: "waves", modelId: "fal-ai/veo3.1", durationSeconds: 8 }, endpoint());
    if (generation?.shape !== "poll") throw new Error("expected poll");
    await generation.job.cancel?.();
    const cancel = standIn.seen.at(-1);
    expect(cancel?.method).toBe("PUT");
    expect(cancel?.path).toBe("/fal-ai/veo3.1/requests/req-2/cancel");
    expect(sentJson(standIn.seen[0])).toEqual({ prompt: "waves", duration: "8" });
  });

  it("reports a COMPLETED with an error as the failure", async () => {
    standIn.answers.set("/m", json({ request_id: "req-3", status_url: `${host()}/m/requests/req-3/status` }));
    standIn.answers.set("/m/requests/req-3/status", json({ status: "COMPLETED", error: "content policy: no", error_type: "content_policy" }));
    const generation = await falMedia.generateVideo?.({ prompt: "x", modelId: "m" }, endpoint());
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(await generation.job.poll()).toEqual({ state: "failed", message: "content policy: no" });
  });
});
