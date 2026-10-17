import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindObservationContext, diagnosticRecorder } from "../../src/observability/recorder.js";
import { OperationObservation, observeOperation, observationFailure } from "../../src/observability/operation.js";
import { createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";
import { BackgroundJobs } from "../../src/process/background.js";
import { MediaJobs } from "../../src/gateway/media/jobs.js";

afterEach(() => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("detached operation observations", () => {
  it("keeps arbitrary error names and accessors out of operational classification", () => {
    const failure = new Error("private failure");
    failure.name = "opaque-credential";
    expect(observationFailure(failure)).toEqual({ errorCode: "unclassified", cancelled: false });
    let reads = 0;
    Object.defineProperty(failure, "name", { get() { reads++; return "AbortError"; } });
    expect(observationFailure(failure)).toEqual({ errorCode: "unclassified", cancelled: false });
    expect(reads).toBe(0);
    expect(observationFailure(new DOMException("cancelled", "AbortError"))).toEqual({ errorCode: "AbortError", cancelled: true });
    expect(observationFailure(new TypeError("invalid"))).toEqual({ errorCode: "TypeError", cancelled: false });
  });
  it("does not regain content consent when an old invocation enters a new child boundary", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const parent = bindObservationContext(createRootExecutionContext({ flue: { instanceId: "selected" } }));
    diagnosticRecorder.clear();
    const failure = new Error("private old invocation failure");
    await expect(runWithExecutionContext(parent, () => observeOperation("tool", "test.old_child", async () => { throw failure; }))).rejects.toBe(failure);
    const events = diagnosticRecorder.read().events;
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.content === undefined && event.contentOmission === "capture_epoch_changed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private old invocation failure");
    expect(bindObservationContext(parent, true).observationCaptureId).toBe(diagnosticRecorder.captureId);
  });
  it("does not introduce old async results or rejections into a replacement capture", async () => {
    diagnosticRecorder.configure({ enabled: true });
    let resolve: ((value: object) => void) | undefined;
    let reject: ((reason: unknown) => void) | undefined;
    const value = {};
    const failure = new Error("old private failure");
    const success = observeOperation("provider", "test.pending", () => new Promise<object>((done) => { resolve = done; }));
    const failed = observeOperation("provider", "test.rejection", () => new Promise((_done, refuse) => { reject = refuse; }));
    const rejection = expect(failed).rejects.toBe(failure);
    diagnosticRecorder.clear();
    resolve?.(value);
    reject?.(failure);
    expect(await success).toBe(value);
    await rejection;
    expect(diagnosticRecorder.read().events).toEqual([]);
  });
  it("preserves the starting parent and fences late ends across capture deletion", () => {
    diagnosticRecorder.configure({ enabled: true });
    const root = createRootExecutionContext();
    const operation = runWithExecutionContext(root, () => new OperationObservation("provider", "test.detached"));
    const started = diagnosticRecorder.read().events[0];
    expect(started?.identity.parentOperationId).toBe(root.operationId);
    expect(started?.identity.requestId).toBe(root.requestId);
    operation.finish("completed");
    operation.finish("failed");
    expect(diagnosticRecorder.read().events).toHaveLength(2);
    diagnosticRecorder.clear();
    operation.progress({ stage: "late" });
    expect(diagnosticRecorder.read().events).toHaveLength(0);
    const active = new OperationObservation("provider", "test.cleared");
    diagnosticRecorder.clear();
    active.finish("completed");
    expect(diagnosticRecorder.read().events).toHaveLength(0);
  });

  it("links media completion and polling to a job without capturing its prompt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-observation-job-"));
    diagnosticRecorder.configure({ enabled: true });
    const jobs = new MediaJobs({ artifactsDirectory: () => directory });
    try {
      const root = createRootExecutionContext();
      const job = runWithExecutionContext(root, () => jobs.start({ conversationId: "selected", slot: "imageGeneration",
        description: "private generation prompt", modelId: "test-model",
        generation: { shape: "poll", job: { id: "external-job", poll: async () => ({ state: "done",
          outputs: [{ mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }] }) } } }));
      expect(job.id).toMatch(/^media_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/);
      expect((await jobs.finished("selected", job.id))?.state).toBe("done");
      const events = diagnosticRecorder.read().events;
      const lifetime = events.filter((event) => event.name === "media.job");
      expect(lifetime.map((event) => event.phase)).toEqual(["start", "end"]);
      expect(lifetime[1]?.outcome).toBe("completed");
      expect(lifetime.every((event) => event.attributes.slot === "imageGeneration" &&
        event.attributes.modelId === "test-model" && event.attributes.shape === "poll")).toBe(true);
      expect(lifetime[1]?.identity).toMatchObject({ requestId: root.requestId, parentOperationId: root.operationId,
        jobId: job.id, externalJobId: "external-job", conversationId: "selected" });
      expect(events.find((event) => event.name === "media.poll")?.identity.parentOperationId).toBe(lifetime[0]?.identity.operationId);
      expect(events.find((event) => event.name === "media.poll")?.identity.conversationId).toBe("selected");
      expect(JSON.stringify(events)).not.toContain("private generation prompt");
    } finally { jobs.stopAll(); await rm(directory, { recursive: true, force: true }); }
  });

  it("confirms one cancellation after the stopped process closes and keeps the command private", async () => {
    diagnosticRecorder.configure({ enabled: true });
    const jobs = new BackgroundJobs();
    try {
      const job = jobs.start({ executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(), command: "private command text", conversationId: "selected" });
      expect(job.id).toMatch(/^job_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/);
      jobs.stop("selected", job.id);
      jobs.stop("selected", job.id);
      expect(diagnosticRecorder.read().events.map((event) => event.phase)).toEqual(["start", "progress"]);
      for (let wait = 0; wait < 100 && !diagnosticRecorder.read().events.some((event) => event.phase === "end"); wait++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const events = diagnosticRecorder.read().events;
      expect(events.map((event) => event.phase)).toEqual(["start", "progress", "end"]);
      expect(events[2]?.outcome).toBe("cancelled");
      expect(events[2]?.attributes.stage).toBe("process_closed");
      expect(events[2]?.identity.jobId).toBe(job.id);
      expect(JSON.stringify(events)).not.toContain("private command text");
    } finally { await jobs.stopAll(); }
  });
});
