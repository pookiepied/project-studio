import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deepgramMedia } from "../../src/gateway/media/adapters/deepgram.js";
import { fishAudioMedia } from "../../src/gateway/media/adapters/fish-audio.js";
import { minimaxMedia } from "../../src/gateway/media/adapters/minimax.js";
import type { DriverEndpoint } from "../../src/gateway/media/drivers/types.js";

/**
 * The three audio vendors against stand-ins on a loopback socket: each
 * one's quirk - Deepgram's Token header and nested transcript, Fish's model
 * header, MiniMax's hex audio and status envelope - is what is pinned.
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
        response.end(JSON.stringify({ message: `nothing staged for ${seen.path}` }));
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

describe("Deepgram", () => {
  const endpoint = (): DriverEndpoint => ({ baseUrl: `${host()}/v1`, credential: "dg-key" });

  it("posts the audio bytes as the body with the Token header, and reads the nested transcript", async () => {
    standIn.answers.set(
      "/v1/listen",
      json({ results: { channels: [{ alternatives: [{ transcript: "hello from nova", confidence: 0.99 }] }] } }),
    );
    const result = await deepgramMedia.transcribe?.(
      { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm", modelId: "nova-3" },
      endpoint(),
    );
    expect(result).toEqual({ text: "hello from nova" });
    const seen = standIn.seen[0];
    expect(seen?.path).toBe("/v1/listen?model=nova-3&smart_format=true");
    expect(seen?.headers.authorization).toBe("Token dg-key");
    expect(seen?.headers["content-type"]).toBe("audio/webm");
    expect([...(seen?.body ?? [])]).toEqual([1, 2, 3]);
  });

  it("speaks through Aura as mp3, the slot's voice standing in for the model name", async () => {
    standIn.answers.set("/v1/speak", () => ({ status: 200, type: "audio/mpeg", body: Buffer.from([0xff]) }));
    const result = await deepgramMedia.speak?.({ text: "Hi.", modelId: "aura-2", voiceId: "aura-2-thalia-en" }, endpoint());
    expect(result).toEqual({ audio: Buffer.from([0xff]).toString("base64"), mimeType: "audio/mpeg" });
    expect(standIn.seen[0]?.path).toBe("/v1/speak?model=aura-2-thalia-en&encoding=mp3");
    expect(sentJson(standIn.seen[0])).toEqual({ text: "Hi." });
  });

  it("relays Deepgram's err_msg", async () => {
    standIn.answers.set("/v1/listen", json({ err_code: "INVALID_AUTH", err_msg: "Invalid credentials." }, 401));
    await expect(
      deepgramMedia.transcribe?.({ audio: new Uint8Array([1]), mimeType: "audio/wav", modelId: "nova-3" }, endpoint()),
    ).rejects.toMatchObject({ kind: "provider-refused", message: expect.stringContaining("Invalid credentials.") });
  });
});

describe("Fish Audio", () => {
  const endpoint = (): DriverEndpoint => ({ baseUrl: `${host()}/v1`, credential: "fish-key" });

  it("names the model in a header and the voice as a reference id, mp3 back", async () => {
    standIn.answers.set("/v1/tts", () => ({ status: 200, type: "audio/mpeg", body: Buffer.from([9]) }));
    const result = await fishAudioMedia.speak?.({ text: "Welcome.", modelId: "s2.1-pro", voiceId: "ref-1" }, endpoint());
    expect(result?.mimeType).toBe("audio/mpeg");
    const seen = standIn.seen[0];
    expect(seen?.headers.model).toBe("s2.1-pro");
    expect(seen?.headers.authorization).toBe("Bearer fish-key");
    expect(sentJson(seen)).toEqual({ text: "Welcome.", format: "mp3", reference_id: "ref-1" });
  });

  it("transcribes as a multipart upload named audio", async () => {
    standIn.answers.set("/v1/asr", json({ text: "hello from fish", duration: 1.2, segments: [] }));
    const result = await fishAudioMedia.transcribe?.(
      { audio: new Uint8Array([4, 5]), mimeType: "audio/webm", modelId: "transcribe-1" },
      endpoint(),
    );
    expect(result).toEqual({ text: "hello from fish" });
    const body = standIn.seen[0]?.body.toString("latin1") ?? "";
    expect(standIn.seen[0]?.headers["content-type"]).toContain("multipart/form-data");
    expect(body).toContain('name="audio"');
  });
});

describe("MiniMax", () => {
  const endpoint = (): DriverEndpoint => ({ baseUrl: host(), credential: "mm-key" });

  it("speaks: hex audio decoded to bytes, the envelope checked", async () => {
    standIn.answers.set(
      "/v1/t2a_v2",
      json({ data: { audio: "fffb90", status: 2 }, extra_info: {}, base_resp: { status_code: 0, status_msg: "success" } }),
    );
    const result = await minimaxMedia.speak?.({ text: "Omg.", modelId: "speech-2.8-hd" }, endpoint());
    expect(result).toEqual({ audio: Buffer.from([0xff, 0xfb, 0x90]).toString("base64"), mimeType: "audio/mpeg" });
    expect(sentJson(standIn.seen[0])).toMatchObject({
      model: "speech-2.8-hd",
      text: "Omg.",
      output_format: "hex",
      voice_setting: { voice_id: "English_expressive_narrator" },
      audio_setting: { format: "mp3" },
    });
    expect(standIn.seen[0]?.headers.authorization).toBe("Bearer mm-key");
  });

  it("treats a non-zero status code as a refusal even on HTTP 200", async () => {
    standIn.answers.set("/v1/t2a_v2", json({ base_resp: { status_code: 1004, status_msg: "insufficient balance" } }));
    await expect(minimaxMedia.speak?.({ text: "x", modelId: "m" }, endpoint())).rejects.toMatchObject({
      kind: "provider-refused",
      message: expect.stringContaining("insufficient balance"),
    });
  });

  it("runs a video task through queued, running and succeeded, downloading the file", async () => {
    let polls = 0;
    standIn.answers.set("/v2/video_generation", json({ task_id: "424", base_resp: { status_code: 0, status_msg: "success" } }));
    standIn.answers.set("/v2/query/video_generation/424", () => {
      polls += 1;
      const status = polls === 1 ? "queued" : polls === 2 ? "running" : "succeeded";
      return {
        status: 200,
        type: "application/json",
        body: JSON.stringify({
          task: { id: "424", status, ...(status === "succeeded" ? { content: { url: `${host()}/cdn/out.mp4` } } : {}) },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
      };
    });
    standIn.answers.set("/cdn/out.mp4", () => ({ status: 200, type: "video/mp4", body: Buffer.from([1, 2]) }));

    const generation = await minimaxMedia.generateVideo?.(
      {
        prompt: "a boy playing basketball by the sea",
        modelId: "MiniMax-H3",
        durationSeconds: 5,
        aspectRatio: "16:9",
        image: { bytes: new Uint8Array([7]), mimeType: "image/png" },
      },
      endpoint(),
    );
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(sentJson(standIn.seen[0])).toEqual({
      model: "MiniMax-H3",
      content: [
        { type: "text", text: "a boy playing basketball by the sea" },
        { type: "image_url", image_url: { url: "data:image/png;base64,Bw==" }, role: "first_frame" },
      ],
      duration: 5,
      ratio: "16:9",
    });
    expect(await generation.job.poll()).toEqual({ state: "queued" });
    expect(await generation.job.poll()).toEqual({ state: "running" });
    const done = await generation.job.poll();
    if (done.state !== "done") throw new Error(`expected done, got ${done.state}`);
    expect([...(done.outputs[0]?.bytes ?? [])]).toEqual([1, 2]);
  });

  it("reports a failed task with MiniMax's message", async () => {
    standIn.answers.set("/v2/video_generation", json({ task_id: "425", base_resp: { status_code: 0 } }));
    standIn.answers.set(
      "/v2/query/video_generation/425",
      json({ task: { id: "425", status: "failed", error: { code: "1026", message: "sensitive content" } }, base_resp: { status_code: 0 } }),
    );
    const generation = await minimaxMedia.generateVideo?.({ prompt: "x", modelId: "MiniMax-H3" }, endpoint());
    if (generation?.shape !== "poll") throw new Error("expected poll");
    expect(await generation.job.poll()).toEqual({ state: "failed", message: "sensitive content" });
  });
});
