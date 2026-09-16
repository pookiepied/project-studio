import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MediaBytes, PollOutcome } from "../../src/gateway/media/adapters/types.js";
import { MediaJobs } from "../../src/gateway/media/jobs.js";

/**
 * The generation job registry, against a scripted vendor: a polled job that
 * answers queued, running, done in turn; a sync one that resolves; and the
 * Stop that reaches the vendor's cancel. Time is injected so the backoff is
 * asserted rather than waited for, and the artifacts directory is a temp
 * directory so "done means the file is on disk" is checked on disk.
 */

let root: string;
let jobs: MediaJobs;
let slept: number[];
let clock: number;

const PNG: MediaBytes = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" };
const MP4: MediaBytes = { bytes: new Uint8Array([0, 0, 0, 0x18, 0x66]), mimeType: "video/mp4" };

function scripted(outcomes: readonly PollOutcome[]): {
  readonly polls: number;
  readonly cancelled: boolean;
  readonly job: { id: string; poll(): Promise<PollOutcome>; cancel(): Promise<void> };
} {
  const state = { polls: 0, cancelled: false };
  const job = {
    id: "vendor-42",
    poll: async () => {
      const outcome = outcomes[Math.min(state.polls, outcomes.length - 1)];
      state.polls += 1;
      if (outcome === undefined) throw new Error("no outcome scripted");
      return outcome;
    },
    cancel: async () => {
      state.cancelled = true;
    },
  };
  return {
    get polls() {
      return state.polls;
    },
    get cancelled() {
      return state.cancelled;
    },
    job,
  };
}

async function settle(): Promise<void> {
  // Enough turns of the microtask queue for a scripted poll loop to finish.
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "studio-media-jobs-"));
  slept = [];
  clock = 1_000;
  jobs = new MediaJobs({
    artifactsDirectory: (conversationId) => join(root, conversationId, "artifacts"),
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    pollIntervalsMs: [10, 20, 50],
    maxDurationMs: 1_000,
  });
});

afterEach(async () => {
  jobs.stopAll();
  await rm(root, { recursive: true, force: true });
});

describe("a polled generation", () => {
  it("is queued, then running with the vendor's word, then done with its file on disk", async () => {
    const vendor = scripted([
      { state: "queued" },
      { state: "running", detail: "rendering frame 12 of 96" },
      { state: "done", outputs: [MP4] },
    ]);
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "a slow push-in on a neon sign",
      modelId: "veo-3.1",
      generation: { shape: "poll", job: vendor.job },
    });
    expect(started.state).toBe("queued");
    expect(started.outputs).toEqual([]);

    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("done");
    expect(finished?.endedAt).not.toBeNull();
    expect(vendor.polls).toBe(3);
    // The backoff walked the configured ladder once per wait.
    expect(slept).toEqual([10, 20]);

    const [output] = finished?.outputs ?? [];
    expect(output?.fileName).toBe(`${started.id}-1.mp4`);
    expect(output?.mimeType).toBe("video/mp4");
    expect(output?.byteLength).toBe(5);
    expect(new Uint8Array(await readFile(output?.path ?? ""))).toEqual(MP4.bytes);
  });

  it("carries the vendor's progress while it runs", async () => {
    const vendor = scripted([{ state: "running", detail: "queued behind 3" }, { state: "running" }]);
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "poll", job: vendor.job },
    });
    await settle();
    expect(jobs.get("conv-1", started.id)?.state).toBe("running");
    expect(jobs.get("conv-1", started.id)?.detail).toBe("queued behind 3");
  });

  it("fails with the vendor's sentence, and writes nothing", async () => {
    const vendor = scripted([{ state: "failed", message: "content policy: no" }]);
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "poll", job: vendor.job },
    });
    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("failed");
    expect(finished?.error).toBe("content policy: no");
    expect(finished?.outputs).toEqual([]);
  });

  it("gives up after the wall-clock limit and tells the vendor", async () => {
    const vendor = scripted([{ state: "running" }]);
    jobs = new MediaJobs({
      artifactsDirectory: () => root,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      pollIntervalsMs: [600],
      maxDurationMs: 1_000,
    });
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "poll", job: vendor.job },
    });
    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("failed");
    expect(finished?.error).toContain("longer than Studio waits");
    expect(vendor.cancelled).toBe(true);
  });

  it("is stopped on request, the vendor is told, and a later poll changes nothing", async () => {
    let release: (outcome: PollOutcome) => void = () => {};
    const gate = new Promise<PollOutcome>((resolve) => {
      release = resolve;
    });
    let cancelled = false;
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "x",
      modelId: "m",
      generation: {
        shape: "poll",
        job: {
          id: "v",
          poll: () => gate,
          cancel: async () => {
            cancelled = true;
          },
        },
      },
    });

    expect(jobs.stop("conv-1", started.id)).toBe(true);
    expect(jobs.get("conv-1", started.id)?.state).toBe("stopped");
    expect(cancelled).toBe(true);

    release({ state: "done", outputs: [MP4] });
    const after = await jobs.finished("conv-1", started.id);
    expect(after?.state).toBe("stopped");
    expect(after?.outputs).toEqual([]);
  });
});

describe("a sync generation", () => {
  it("is a job too: running until its promise settles, then done with its files", async () => {
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "a red bicycle",
      modelId: "gpt-image-2",
      generation: { shape: "sync", result: Promise.resolve([PNG, PNG]) },
    });
    expect(started.state).toBe("running");

    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("done");
    expect(finished?.outputs.map((output) => output.fileName)).toEqual([
      `${started.id}-1.png`,
      `${started.id}-2.png`,
    ]);
    expect(slept).toEqual([]);
  });

  it("fails with the adapter's sentence when the promise rejects", async () => {
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "sync", result: Promise.reject(new Error("401 from the vendor")) },
    });
    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("failed");
    expect(finished?.error).toBe("401 from the vendor");
  });

  it("treats an empty result as a failure rather than a done job with nothing in it", async () => {
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "sync", result: Promise.resolve([]) },
    });
    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.state).toBe("failed");
  });
});

describe("the registry", () => {
  it("scopes reads and stops to the conversation that started the job", async () => {
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "sync", result: Promise.resolve([PNG]) },
    });
    expect(jobs.get("conv-2", started.id)).toBeUndefined();
    expect(jobs.list("conv-2")).toEqual([]);
    expect(jobs.stop("conv-2", started.id)).toBe(false);
    expect(await jobs.finished("conv-2", started.id)).toBeUndefined();
    expect(jobs.list("conv-1").map((job) => job.id)).toEqual([started.id]);
  });

  it("reports each ended job once, to whoever asks first", async () => {
    // Nobody waited: the end is drained once, then never again.
    const unwatched = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "sync", result: Promise.resolve([PNG]) },
    });
    expect(jobs.drainFinished("conv-1")).toEqual([]);
    while (jobs.list("conv-1").find((job) => job.id === unwatched.id)?.state !== "done") {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(jobs.drainFinished("conv-1").map((job) => job.id)).toEqual([unwatched.id]);
    expect(jobs.drainFinished("conv-1")).toEqual([]);

    // Somebody waited for the end: they report it, and the drain does not
    // say it again - the image tool answers with its files, and the notice
    // on the same call's way back must not list them a second time.
    const watched = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "y",
      modelId: "m",
      generation: { shape: "sync", result: Promise.resolve([PNG]) },
    });
    await jobs.finished("conv-1", watched.id);
    expect(jobs.drainFinished("conv-1")).toEqual([]);
  });

  it("names files by the job and the output's index, with an extension from the bytes' type", async () => {
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "imageGeneration",
      description: "x",
      modelId: "m",
      generation: {
        shape: "sync",
        result: Promise.resolve([
          { bytes: new Uint8Array([1]), mimeType: "image/jpeg" },
          { bytes: new Uint8Array([2]), mimeType: "application/x-unknown" },
        ]),
      },
    });
    const finished = await jobs.finished("conv-1", started.id);
    expect(finished?.outputs.map((output) => output.fileName)).toEqual([
      `${started.id}-1.jpg`,
      `${started.id}-2.bin`,
    ]);
  });
});

/**
 * The end announcements, the finished-job ping's way in.
 *
 * The promise is about timing as much as fact: the listener hears the
 * conversation while the ending still reads untold, so whoever hears it is
 * the one whose drain delivers it. And a stop - the one ending somebody
 * chose to watch - tells its announcement nothing: the told-marker precedes
 * the end, which is how the announcement learns the news was taken, not
 * missed.
 */
describe("the end announcements", () => {
  it("name the conversation at the moment the ending still reads untold", async () => {
    const heard: string[] = [];
    const untoldAtAnnouncement: (string | undefined)[] = [];
    jobs.onEnded((conversationId) => {
      heard.push(conversationId);
      // The announcement's own contract: its drain is what delivers. At the
      // moment of the announcement the ending must still be there to take.
      untoldAtAnnouncement.push(jobs.drainFinished(conversationId)[0]?.id);
    });

    const vendor = scripted([{ state: "done", outputs: [MP4] }]);
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "x",
      modelId: "m",
      generation: { shape: "poll", job: vendor.job },
    });
    await jobs.finished("conv-1", started.id);

    expect(heard).toEqual(["conv-1"]);
    expect(untoldAtAnnouncement).toEqual([started.id]);
  });

  it("find a stopped job already told", async () => {
    let untoldAtAnnouncement: number | undefined;
    jobs.onEnded((conversationId) => {
      untoldAtAnnouncement = jobs.drainFinished(conversationId).length;
    });

    let release: (outcome: PollOutcome) => void = () => {};
    const gate = new Promise<PollOutcome>((resolve) => {
      release = resolve;
    });
    const started = jobs.start({
      conversationId: "conv-1",
      slot: "videoGeneration",
      description: "x",
      modelId: "m",
      generation: {
        shape: "poll",
        job: { id: "v", poll: () => gate, cancel: async () => undefined },
      },
    });

    jobs.stop("conv-1", started.id);
    // The one #end the stop fired announced an empty drain: the news was
    // taken, not missed, whoever heard it.
    expect(untoldAtAnnouncement).toBe(0);

    // The poll's late answer changes neither the state nor the
    // announcements: a job that already ended once does not end twice.
    release({ state: "done", outputs: [MP4] });
    await jobs.finished("conv-1", started.id);
    expect(untoldAtAnnouncement).toBe(0);
  });
});
