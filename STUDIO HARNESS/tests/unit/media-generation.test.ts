import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryCredentialStore } from "../../src/credentials/memory-store.js";
import { CapabilityResolver } from "../../src/gateway/connections/capability-defaults.js";
import { ConnectionStore } from "../../src/gateway/connections/connection-store.js";
import { ModelCatalog } from "../../src/gateway/connections/model-catalog.js";
import type {
  Generation,
  ImageGenerationInput,
  MediaAdapter,
  VideoGenerationInput,
} from "../../src/gateway/media/adapters/types.js";
import type { DriverEndpoint } from "../../src/gateway/media/drivers/types.js";
import { MediaJobs } from "../../src/gateway/media/jobs.js";
import { MediaService } from "../../src/gateway/media/service.js";
import { conversationArtifactsDirectory } from "../../src/platform/paths.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import {
  createAdmissionMiddleware,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";
import { createMediaRoutes } from "../../src/transport/http/routes/media.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";

/**
 * Generation through the service: the slot resolves to a connection, the
 * connection's media wire picks the adapter, the adapter's answer becomes a
 * job. The adapter here is a stand-in that records what it was handed and
 * answers what the test scripts, so what is pinned is the dispatch - which
 * slot, which wire, which model, which endpoint - and not any vendor.
 */

let root: string;
let previousHome: string | undefined;
let db: StudioDatabase;
let credentials: InMemoryCredentialStore;
let connections: ConnectionStore;
let catalog: ModelCatalog;
let jobs: MediaJobs;

interface Recorded {
  readonly images: { input: ImageGenerationInput; endpoint: DriverEndpoint }[];
  readonly videos: { input: VideoGenerationInput; endpoint: DriverEndpoint }[];
}

function standIn(protocol: "openai" | "openrouter" | "fal", answer: () => Generation): { adapter: MediaAdapter; recorded: Recorded } {
  const recorded: Recorded = { images: [], videos: [] };
  const adapter: MediaAdapter = {
    protocol,
    generateImage: async (input, endpoint) => {
      recorded.images.push({ input, endpoint });
      return answer();
    },
    generateVideo: async (input, endpoint) => {
      recorded.videos.push({ input, endpoint });
      return answer();
    },
  };
  return { adapter, recorded };
}

function service(adapters: readonly MediaAdapter[]): MediaService {
  return new MediaService({
    resolver: new CapabilityResolver({ connections, catalog, credentials }),
    adapters: new Map(adapters.map((adapter) => [adapter.protocol, adapter])),
    jobs,
  });
}

async function connectOpenAi(): Promise<void> {
  await connections.add({
    id: "openai",
    displayName: "OpenAI",
    serves: { language: "openai-responses", media: "openai" },
    source: "local",
    enabled: true,
    catalogProvider: "openai",
    baseUrl: "https://api.openai.test/v1",
    apiKey: "sk-openai-media-1",
  });
  await catalog.setDefault("imageGeneration", { connectionId: "openai", modelId: "gpt-image-2" });
  await catalog.setDefault("imageEditing", {
    connectionId: "openai",
    modelId: "gpt-image-2.5-flare",
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-media-gen-"));
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = root;
  db = openDatabase({ path: ":memory:" });
  credentials = new InMemoryCredentialStore();
  connections = new ConnectionStore({ db, credentials });
  // Generation is the question here, not listings: no socket to a vendor.
  catalog = new ModelCatalog({ db, connections, liveListings: false });
  // The registry writes where the route reads: the conversation's artifacts
  // directory under the Studio home, which the test points at a temp root.
  jobs = new MediaJobs({
    artifactsDirectory: conversationArtifactsDirectory,
    sleep: async () => undefined,
  });
});

afterEach(async () => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
  jobs.stopAll();
  db.close();
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

const PNG = { bytes: new Uint8Array([0x89, 0x50]), mimeType: "image/png" };

describe("image generation through the service", () => {
  it("resolves the slot, picks the adapter by the connection's media wire, and runs a job", async () => {
    diagnosticRecorder.configure({ enabled: true });
    await connectOpenAi();
    const { adapter, recorded } = standIn("openai", () => ({
      shape: "sync",
      result: Promise.resolve([PNG]),
    }));
    const other = standIn("openrouter", () => {
      throw new Error("the wrong adapter was asked");
    });
    const media = service([other.adapter, adapter]);

    const started = await media.generateImage(
      { prompt: "a red bicycle", size: "1024x1024" },
      { conversationId: "conv-1" },
    );
    const finished = await jobs.finished("conv-1", started.id);

    expect(finished?.state).toBe("done");
    expect(finished?.slot).toBe("imageGeneration");
    expect(finished?.modelId).toBe("gpt-image-2");
    expect(finished?.description).toBe("a red bicycle");
    expect(recorded.images).toHaveLength(1);
    expect(recorded.images[0]?.input.modelId).toBe("gpt-image-2");
    expect(recorded.images[0]?.input.size).toBe("1024x1024");
    // The credential reaches the adapter's endpoint and nowhere else.
    expect(recorded.images[0]?.endpoint.credential).toBe("sk-openai-media-1");
    expect(recorded.images[0]?.endpoint.baseUrl).toBe("https://api.openai.test/v1");
    expect(JSON.stringify(finished)).not.toContain("sk-openai");
    const events = diagnosticRecorder.read().events;
    const dispatch = events.filter((event) => event.name === "media.dispatch");
    const binding = events.find((event) => event.name === "media.binding");
    expect(binding).toMatchObject({ phase: "progress", attributes: { stage: "resolved", connectionId: "openai",
      slot: "imageGeneration", modelId: "gpt-image-2", protocol: "openai" } });
    expect(binding?.identity.operationId).toBe(dispatch[0]?.identity.parentOperationId);
    expect(dispatch.map((event) => event.phase)).toEqual(["start", "end"]);
    expect(dispatch.every((event) => event.identity.conversationId === "conv-1" &&
      event.attributes.slot === "imageGeneration" && event.attributes.modelId === "gpt-image-2" &&
      event.attributes.protocol === "openai")).toBe(true);
    expect(dispatch[1]?.outcome).toBe("completed");
    expect(JSON.stringify(events)).not.toContain("sk-openai");
    expect(JSON.stringify(events)).not.toContain("api.openai.test");
    expect(JSON.stringify(events)).not.toContain("a red bicycle");
  });

  it("calls a library vendor at the library's own address when the connection carries none", async () => {
    // A connection added from the library stores no base URL on purpose:
    // absent means the vendor's own. FAL's address lives in the declared
    // catalog, and a generation must find it there rather than refuse.
    await connections.add({
      id: "fal",
      displayName: "FAL",
      serves: { media: "fal" },
      source: "local",
      enabled: true,
      catalogProvider: "fal",
      apiKey: "fal-key-1",
    });
    await catalog.setDefault("imageGeneration", { connectionId: "fal", modelId: "fal-ai/flux-2-pro" });
    const { adapter, recorded } = standIn("fal", () => ({
      shape: "sync",
      result: Promise.resolve([PNG]),
    }));
    const media = service([adapter]);

    const started = await media.generateImage({ prompt: "a lighthouse" }, { conversationId: "conv-1" });
    const finished = await jobs.finished("conv-1", started.id);

    expect(finished?.state).toBe("done");
    expect(recorded.images[0]?.endpoint.baseUrl).toBe("https://queue.fal.run");
    expect(recorded.images[0]?.endpoint.credential).toBe("fal-key-1");
  });

  it("is an edit when input images travel, and resolves the editing slot's own model", async () => {
    await connectOpenAi();
    const { adapter, recorded } = standIn("openai", () => ({
      shape: "sync",
      result: Promise.resolve([PNG]),
    }));
    const media = service([adapter]);

    const started = await media.generateImage(
      { prompt: "make the sky green", inputImages: [PNG] },
      { conversationId: "conv-1" },
    );
    await jobs.finished("conv-1", started.id);

    expect(started.slot).toBe("imageEditing");
    expect(recorded.images[0]?.input.modelId).toBe("gpt-image-2.5-flare");
    expect(recorded.images[0]?.input.inputImages).toHaveLength(1);
  });

  it("lets a caller name a model over the slot's own", async () => {
    await connectOpenAi();
    const { adapter, recorded } = standIn("openai", () => ({
      shape: "sync",
      result: Promise.resolve([PNG]),
    }));
    const media = service([adapter]);
    await media.generateImage({ prompt: "x" }, { conversationId: "conv-1", modelId: "gpt-image-2.5-sunburst" });
    expect(recorded.images[0]?.input.modelId).toBe("gpt-image-2.5-sunburst");
  });

  it("refuses an unset slot, naming the fix, before any adapter is asked", async () => {
    const { adapter, recorded } = standIn("openai", () => {
      throw new Error("must not be asked");
    });
    const media = service([adapter]);
    await expect(media.generateImage({ prompt: "x" }, { conversationId: "conv-1" })).rejects.toMatchObject({
      kind: "slot-unset",
    });
    expect(recorded.images).toHaveLength(0);
  });

  it("refuses a wire no adapter speaks yet, as a protocol failure", async () => {
    await connectOpenAi();
    const media = service([]);
    await expect(media.generateImage({ prompt: "x" }, { conversationId: "conv-1" })).rejects.toMatchObject({
      kind: "slot-protocol",
    });
  });
});

describe("video generation through the service", () => {
  it("runs a polled job and answers before it is done", async () => {
    await connections.add({
      id: "google",
      displayName: "Google",
      serves: { language: "google-generative-ai", media: "google" },
      source: "local",
      enabled: true,
      catalogProvider: "google",
      baseUrl: "https://gemini.test/v1beta",
      apiKey: "g-key",
    });
    await catalog.setDefault("videoGeneration", {
      connectionId: "google",
      modelId: "veo-3.1-generate-preview",
    });
    let polls = 0;
    const adapter: MediaAdapter = {
      protocol: "google",
      generateVideo: async () => ({
        shape: "poll",
        job: {
          id: "op-1",
          poll: async () => {
            polls += 1;
            return polls < 3
              ? { state: "running", detail: `step ${String(polls)}` }
              : { state: "done", outputs: [{ bytes: new Uint8Array([1, 2]), mimeType: "video/mp4" }] };
          },
        },
      }),
    };
    const media = service([adapter]);

    const started = await media.generateVideo({ prompt: "waves", durationSeconds: 8 }, { conversationId: "conv-1" });
    expect(started.state).toBe("queued");
    expect(started.slot).toBe("videoGeneration");

    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("done");
    expect(finished?.outputs[0]?.fileName).toBe(`${started.id}-1.mp4`);
    expect(media.listJobs("conv-1").map((job) => job.id)).toEqual([started.id]);
  });
});

describe("the generation routes", () => {
  function routed(media: MediaService): { app: Hono<AdmissionEnv>; credential: string } {
    const session = createAdmissionSession();
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/media", createMediaRoutes(media));
    return { app, credential: session.credential };
  }

  it("lists a conversation's jobs, stops one, and serves a finished output's bytes", async () => {
    await connectOpenAi();
    const { adapter } = standIn("openai", () => ({ shape: "sync", result: Promise.resolve([PNG]) }));
    const media = service([adapter]);
    const started = await media.generateImage({ prompt: "x" }, { conversationId: "conv-1" });
    const finished = await jobs.finished("conv-1", started.id);
    const { app, credential } = routed(media);
    const headers = { authorization: `Bearer ${credential}`, "content-type": "application/json" };

    const list = await app.request("http://harness.test/api/media/jobs?conversationId=conv-1", { headers });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { jobs: { id: string; state: string }[] };
    expect(listed.jobs.map((job) => [job.id, job.state])).toEqual([[started.id, "done"]]);

    const bytes = await app.request(
      `http://harness.test/api/media/artifacts/conv-1/${finished?.outputs[0]?.fileName ?? ""}`,
      { headers },
    );
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("content-type")).toBe("image/png");
    expect(bytes.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PNG.bytes);

    const stop = await app.request(`http://harness.test/api/media/jobs/${started.id}/stop`, {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId: "conv-1" }),
    });
    expect(stop.status).toBe(200);
    const missing = await app.request("http://harness.test/api/media/jobs/media_nope1/stop", {
      method: "POST",
      headers,
      body: JSON.stringify({ conversationId: "conv-1" }),
    });
    expect(missing.status).toBe(404);
  });

  it("lists a conversation's finished generations by the names their files carry", async () => {
    await connectOpenAi();
    const { adapter } = standIn("openai", () => ({ shape: "sync", result: Promise.resolve([PNG]) }));
    const media = service([adapter]);
    const started = await media.generateImage({ prompt: "x" }, { conversationId: "conv-1" });
    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("done");
    const { app, credential } = routed(media);
    const headers = { authorization: `Bearer ${credential}` };

    // The same output the job's status reports, under the name its file was
    // written with - the contract a card whose registry forgot the job reads.
    const list = await app.request("http://harness.test/api/media/artifacts/conv-1", { headers });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { artifacts: { fileName: string; mimeType: string }[] };
    expect(listed.artifacts).toEqual([{ fileName: `${started.id}-1.png`, mimeType: "image/png" }]);

    // A conversation nothing was generated into answers empty, not an error:
    // its directory exists from its first admitted prompt and holds nothing.
    const empty = await app.request("http://harness.test/api/media/artifacts/conv-2", { headers });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { artifacts: unknown[] }).artifacts).toEqual([]);

    // A conversation id the directories could not have written.
    const traversal = await app.request("http://harness.test/api/media/artifacts/..%2Fconv-2", {
      headers,
    });
    expect(traversal.status).toBe(404);
  });

  it("refuses an artifact name the registry could not have written", async () => {
    const media = service([]);
    const { app, credential } = routed(media);
    const headers = { authorization: `Bearer ${credential}` };
    for (const name of ["..%2F..%2Fsecrets.txt", "notes.txt", "media_abc1-1.png%00.txt"]) {
      const response = await app.request(`http://harness.test/api/media/artifacts/conv-1/${name}`, {
        headers,
      });
      expect(response.status).toBe(404);
    }
    const traversal = await app.request("http://harness.test/api/media/artifacts/..%2Fconv-2/media_abc1-1.png", {
      headers,
    });
    expect(traversal.status).toBe(404);
  });
});
