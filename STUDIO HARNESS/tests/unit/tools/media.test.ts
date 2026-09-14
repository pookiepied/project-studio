import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { MediaError } from "../../../src/contracts/media.js";
import type { MediaJobStatus } from "../../../src/gateway/media/jobs.js";
import { MediaJobs } from "../../../src/gateway/media/jobs.js";
import type { MediaService } from "../../../src/gateway/media/service.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { ImageBudget } from "../../../src/tools/filesystem/image-budget.js";
import { CallGate } from "../../../src/tools/gate.js";
import { mediaFinishedNotice, mediaJobLines, registerMediaTools } from "../../../src/tools/media/index.js";

/**
 * The generation tools against a stand-in service: what the model's
 * arguments become, what the result says, and when the picture goes back
 * as an image block. The job registry is the real one, so "waits for the
 * job" is waited for.
 */

const SCOPE: ExecutionScope = { conversationId: "conv-1", projectId: "proj-1", agentId: "studio" };

let db: StudioDatabase;
let gate: CallGate;
let root: string;
let jobs: MediaJobs;
let generated: { image: unknown[]; video: unknown[] };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function standInService(overrides: Partial<MediaService> = {}): MediaService {
  const service = {
    jobs,
    listJobs: (conversationId: string) => jobs.list(conversationId),
    stopJob: (conversationId: string, id: string) => jobs.stop(conversationId, id),
    generateImage: async (input: unknown, options: { conversationId: string }): Promise<MediaJobStatus> => {
      generated.image.push(input);
      return jobs.start({
        conversationId: options.conversationId,
        slot: "imageGeneration",
        description: (input as { prompt: string }).prompt,
        modelId: "openai/gpt-image-2",
        generation: { shape: "sync", result: Promise.resolve([{ bytes: PNG, mimeType: "image/png" }]) },
      });
    },
    generateVideo: async (input: unknown, options: { conversationId: string }): Promise<MediaJobStatus> => {
      generated.video.push(input);
      return jobs.start({
        conversationId: options.conversationId,
        slot: "videoGeneration",
        description: (input as { prompt: string }).prompt,
        modelId: "google/veo-3.1",
        generation: {
          shape: "poll",
          job: { id: "v1", poll: async () => ({ state: "done", outputs: [{ bytes: new Uint8Array([1]), mimeType: "video/mp4" }] }) },
        },
      });
    },
    ...overrides,
  };
  return service as unknown as MediaService;
}

function build(media: MediaService, options: { acceptsImages?: boolean; budget?: ImageBudget } = {}): void {
  gate = new CallGate({
    kernel: new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver: { request: async () => ({ verdict: "allow", duration: "once" }) },
    }),
    sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: root, allowNetwork: true })),
  });
  registerMediaTools(gate, {
    media,
    acceptsImages: () => options.acceptsImages,
    ...(options.budget === undefined ? {} : { imageBudget: options.budget }),
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-media-tools-"));
  db = openDatabase({ path: ":memory:" });
  jobs = new MediaJobs({ artifactsDirectory: (id) => join(root, "artifacts", id), sleep: async () => undefined });
  generated = { image: [], video: [] };
});

afterEach(async () => {
  jobs.stopAll();
  db.close();
  await rm(root, { recursive: true, force: true });
});

const image = (input: unknown) => gate.call({ name: "native/studio_image", input, scope: SCOPE });
const video = (input: unknown) => gate.call({ name: "native/studio_video", input, scope: SCOPE });

describe("studio_image", () => {
  it("waits for the job and answers with the Artifact line and the picture", async () => {
    build(standInService(), { acceptsImages: true });
    const result = (await image({ prompt: "a red bicycle", aspect_ratio: "1:1", count: 2 })) as {
      content: { type: string; text?: string; data?: string; mimeType?: string }[];
    };
    expect(generated.image[0]).toEqual({ prompt: "a red bicycle", aspectRatio: "1:1", count: 2 });
    const [text, picture] = result.content;
    expect(text?.text).toContain("Generated 1 image with openai/gpt-image-2.");
    expect(text?.text).toMatch(/^Artifact: \/api\/media\/artifacts\/conv-1\/media_[a-z0-9]+-1\.png \(image\/png\)$/m);
    expect(picture).toEqual({ type: "image", data: Buffer.from(PNG).toString("base64"), mimeType: "image/png" });
  });

  it("answers in words alone when the model cannot see, and the picture is still on disk", async () => {
    build(standInService(), { acceptsImages: false });
    const result = (await image({ prompt: "x" })) as { content: { type: string }[] };
    expect(result.content.map((block) => block.type)).toEqual(["text"]);
    expect(jobs.list("conv-1")[0]?.outputs).toHaveLength(1);
  });

  it("keeps to the conversation's image budget", async () => {
    const budget = new ImageBudget();
    for (let n = 0; n < 20; n += 1) budget.record("conv-1", 10);
    build(standInService(), { acceptsImages: true, budget });
    const result = (await image({ prompt: "x" })) as { content: { type: string }[] };
    expect(result.content.map((block) => block.type)).toEqual(["text"]);
  });

  it("reads input images from the workspace and makes the call an edit", async () => {
    await writeFile(join(root, "sky.png"), PNG);
    build(standInService(), { acceptsImages: false });
    await image({ prompt: "make the sky green", input_paths: ["sky.png"] });
    const input = generated.image[0] as { inputImages: { mimeType: string; bytes: Uint8Array }[] };
    expect(input.inputImages).toHaveLength(1);
    expect(input.inputImages[0]?.mimeType).toBe("image/png");
    expect([...(input.inputImages[0]?.bytes ?? [])]).toEqual([...PNG]);
  });

  it("refuses arguments the tool does not take, before any generation", async () => {
    build(standInService());
    await expect(image({})).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(image({ prompt: "x", aspect_ratio: "wide" })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(image({ prompt: "x", size: "big" })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(image({ prompt: "x", count: 9 })).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(image({ prompt: "x", input_paths: ["notes.txt"] })).rejects.toMatchObject({ kind: "invalid_input" });
    expect(generated.image).toHaveLength(0);
  });

  it("turns an unset slot into an unavailable tool, naming the fix", async () => {
    build(
      standInService({
        generateImage: async () => {
          throw new MediaError("slot-unset", "No image model is connected. Choose one in Settings - Providers.");
        },
      }),
    );
    await expect(image({ prompt: "x" })).rejects.toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("Settings"),
    });
  });

  it("fails with the vendor's sentence when the job does", async () => {
    build(
      standInService({
        generateImage: async (_input: unknown, options: { conversationId: string }) =>
          jobs.start({
            conversationId: options.conversationId,
            slot: "imageGeneration",
            description: "x",
            modelId: "m",
            generation: { shape: "sync", result: Promise.reject(new Error("content policy: no")) },
          }),
      }),
    );
    await expect(image({ prompt: "x" })).rejects.toMatchObject({
      kind: "execution_failed",
      message: expect.stringContaining("content policy: no"),
    });
  });
});

describe("studio_video", () => {
  it("starts the job and answers at once with its id", async () => {
    build(standInService());
    const answer = (await video({ prompt: "waves", duration_seconds: 8, resolution: "720p" })) as string;
    expect(answer).toMatch(/^Started video job media_[a-z0-9]+ with google\/veo-3\.1\./);
    expect(generated.video[0]).toEqual({ prompt: "waves", durationSeconds: 8, resolution: "720p" });
  });

  it("is told about once, as an Artifact line, after the job lands", async () => {
    const media = standInService();
    build(media);
    const answer = (await video({ prompt: "waves" })) as string;
    const id = /media_[a-z0-9]+/.exec(answer)?.[0] ?? "";
    // Nobody waits for a video the way the image tool waits for a picture;
    // the job ends on its own and the next notice is the first to tell it.
    while (jobs.list("conv-1").find((job) => job.id === id)?.state !== "done") {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const first = mediaJobLines(media, "conv-1");
    expect(first.running).toEqual([]);
    expect(first.ended).toHaveLength(1);
    expect(first.ended[0]).toContain(`${id} finished: waves`);
    expect(first.ended[0]).toMatch(/Artifact: \/api\/media\/artifacts\/conv-1\/media_[a-z0-9]+-1\.mp4 \(video\/mp4\)/);
    expect(mediaFinishedNotice(first.ended)).toContain("Generation job has ended");

    expect(mediaJobLines(media, "conv-1").ended).toEqual([]);
    expect(mediaFinishedNotice([])).toBeUndefined();
  });
});
