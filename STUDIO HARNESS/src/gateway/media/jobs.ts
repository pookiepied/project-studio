import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CapabilitySlot } from "../../contracts/providers.js";
import type { Generation, MediaBytes, PolledGeneration } from "./adapters/types.js";

/**
 * Generations that outlive the call that started them.
 *
 * A video takes minutes, not seconds, and some images take long enough to
 * matter. A tool call that blocks for the whole of that is a turn that
 * cannot do anything else, a person looking at a spinner, and a connection
 * that a proxy somewhere will close before the vendor answers. So a
 * generation is a job: started, given an id at once, asked after, and
 * stopped - the same shape `process/background.ts` gives a dev server, for
 * the same reasons, with the process replaced by a vendor's queue.
 *
 * ---- The job owns the bytes ------------------------------------------------
 *
 * When a job ends well its outputs are written to the conversation's
 * artifacts directory before the job is marked done, so "done" always means
 * "the file is on disk". Nothing here keeps a vendor URL: the adapter has
 * already downloaded the bytes inside its poll (see `adapters/types.ts`),
 * and what the status reports is the file Studio holds. A file name carries
 * the job id and the output's index, and its extension follows the bytes'
 * type, so a directory listing reads as what it is.
 *
 * ---- Sync and poll are one path --------------------------------------------
 *
 * An adapter answers with a promise of bytes or a polled generation. Both
 * become a job here: the sync one ends when its promise settles, the polled
 * one when a poll says done. A caller that wants to wait - the image tool,
 * which returns the picture in the same call - awaits `finished`; a caller
 * that wants to go on - the video tool - returns the id. One registry, one
 * status shape, one Stop.
 *
 * ---- Polling cadence -------------------------------------------------------
 *
 * Fast at first, because a fast model may be done in seconds, then backing
 * off to a ceiling so a ten-minute video costs the vendor sixty status calls
 * rather than three hundred. A hard wall-clock limit ends a job the vendor
 * has forgotten about; without it a stuck job would poll until Studio quit.
 *
 * ---- Lifetime --------------------------------------------------------------
 *
 * A job belongs to the conversation that started it and outlives the turn.
 * It does not outlive the harness: `stopAll` runs on shutdown, and a job
 * with a cancel endpoint is cancelled rather than merely forgotten.
 */

export type MediaJobState = "queued" | "running" | "done" | "failed" | "stopped";

interface MediaJobOutput {
  /** The file's full path on this machine. */
  readonly path: string;
  /** The file's name inside the conversation's artifacts directory. */
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteLength: number;
}

export interface MediaJobStatus {
  readonly id: string;
  readonly conversationId: string;
  readonly slot: CapabilitySlot;
  /** The prompt, or whatever a person would recognise the job by. */
  readonly description: string;
  readonly modelId: string;
  readonly state: MediaJobState;
  /** The vendor's own word on progress, when it gives one. */
  readonly detail: string | undefined;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly outputs: readonly MediaJobOutput[];
  /** Why it failed, when it did. */
  readonly error?: string;
}

export interface StartMediaJobOptions {
  readonly conversationId: string;
  readonly slot: CapabilitySlot;
  readonly description: string;
  readonly modelId: string;
  readonly generation: Generation;
}

export interface MediaJobsOptions {
  /** Where one conversation's artifacts land. */
  readonly artifactsDirectory: (conversationId: string) => string;
  /** Injectable for tests; production sleeps. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; production reads the clock. */
  readonly now?: () => number;
  readonly pollIntervalsMs?: readonly number[];
  readonly maxDurationMs?: number;
}

interface Job {
  readonly id: string;
  readonly conversationId: string;
  readonly slot: CapabilitySlot;
  readonly description: string;
  readonly modelId: string;
  readonly startedAt: number;
  state: MediaJobState;
  detail: string | undefined;
  endedAt: number | null;
  outputs: MediaJobOutput[];
  error?: string;
  reported: boolean;
  polled: PolledGeneration | undefined;
  /** Resolves when the job has ended, however it ended. */
  readonly settled: Promise<void>;
  settle: () => void;
}

/** Two seconds, then five, then ten for as long as it takes. */
const DEFAULT_POLL_INTERVALS_MS: readonly number[] = [2_000, 3_000, 5_000, 5_000, 10_000];

/** Thirty minutes: longer than any vendor's documented video ceiling. */
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1_000;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

function extensionOf(mimeType: string): string {
  return EXTENSIONS[mimeType.toLowerCase().split(";")[0]?.trim() ?? ""] ?? "bin";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MediaJobs {
  readonly #jobs = new Map<string, Job>();
  /**
   * Who hears that a generation has ended, in the conversation that started
   * it. The finished-job ping's hook into this registry. Fired from `#end`,
   * while the job still reads untold - so whoever hears it delivers it - and
   * silently for a stop, whose `reported` marker precedes the end: whoever
   * stopped it was the news's only intended reader.
   */
  readonly #endListeners = new Set<(conversationId: string) => void>();
  readonly #artifactsDirectory: (conversationId: string) => string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #intervals: readonly number[];
  readonly #maxDurationMs: number;
  #counter = 0;
  /** The same run tag `BackgroundJobs` uses, for the same reason: an id from before a restart must mean nothing. */
  readonly #tag = Math.random().toString(36).slice(2, 5);

  constructor(options: MediaJobsOptions) {
    this.#artifactsDirectory = options.artifactsDirectory;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? (() => Date.now());
    this.#intervals = options.pollIntervalsMs ?? DEFAULT_POLL_INTERVALS_MS;
    this.#maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  }

  /** Starts driving a generation and returns its status at once. */
  start(options: StartMediaJobOptions): MediaJobStatus {
    this.#counter += 1;
    const id = `media_${this.#tag}${this.#counter}`;
    let settle: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const job: Job = {
      id,
      conversationId: options.conversationId,
      slot: options.slot,
      description: options.description,
      modelId: options.modelId,
      startedAt: this.#now(),
      state: options.generation.shape === "poll" ? "queued" : "running",
      detail: undefined,
      endedAt: null,
      outputs: [],
      reported: false,
      polled: options.generation.shape === "poll" ? options.generation.job : undefined,
      settled,
      settle,
    };
    this.#jobs.set(id, job);

    void this.#drive(job, options.generation);
    return statusOf(job);
  }

  /** Registers a listener that hears, with the conversation id, when one of this registry's jobs ends. */
  onEnded(listener: (conversationId: string) => void): void {
    this.#endListeners.add(listener);
  }

  /** One job, if it belongs to the asking conversation. */
  get(conversationId: string, id: string): MediaJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (job === undefined || job.conversationId !== conversationId) return undefined;
    return statusOf(job);
  }

  /** Every job this conversation started, oldest first. */
  list(conversationId: string): readonly MediaJobStatus[] {
    return [...this.#jobs.values()]
      .filter((job) => job.conversationId === conversationId)
      .map((job) => statusOf(job));
  }

  /**
   * The status once the job has ended. Undefined if there is no such job.
   *
   * Waiting for the end is reporting it: the caller answers with the
   * outputs itself, so the job is marked told here and the drained notice
   * on the same call's way back does not list the same files a second
   * time - which put every generated image in the transcript twice.
   */
  async finished(conversationId: string, id: string): Promise<MediaJobStatus | undefined> {
    const job = this.#jobs.get(id);
    if (job === undefined || job.conversationId !== conversationId) return undefined;
    await job.settled;
    job.reported = true;
    return statusOf(job);
  }

  /**
   * Stops one job. Answers whether there was one to stop.
   *
   * The vendor is told when it can be told. A job already ended is left as
   * it ended; a stop is somebody watching, so there is nothing left to tell
   * them about this one.
   */
  stop(conversationId: string, id: string): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined || job.conversationId !== conversationId) return false;
    // Marked told before the end, so the announcement the end fires finds
    // nothing to deliver: a stop is somebody already watching, and the
    // drained-and-empty answer is how the announcement learns that.
    job.reported = true;
    if (job.state === "queued" || job.state === "running") {
      this.#end(job, "stopped");
      const polled = job.polled;
      if (polled?.cancel !== undefined) {
        void polled.cancel().catch(() => {
          // The vendor could not be told. The job is stopped on our side
          // either way; whatever the vendor finishes, nobody collects.
        });
      }
    }
    return true;
  }

  /**
   * The jobs that have ended since anyone last asked, marked as told - the
   * same drained notice `BackgroundJobs` gives, so a video that finished
   * while the model was doing something else reaches it once.
   */
  drainFinished(conversationId: string): readonly MediaJobStatus[] {
    const finished: MediaJobStatus[] = [];
    for (const job of this.#jobs.values()) {
      if (job.conversationId !== conversationId) continue;
      if (job.state === "queued" || job.state === "running" || job.reported) continue;
      job.reported = true;
      finished.push(statusOf(job));
    }
    return finished;
  }

  /** Everything, for shutdown. */
  stopAll(): void {
    for (const job of this.#jobs.values()) {
      this.stop(job.conversationId, job.id);
    }
  }

  async #drive(job: Job, generation: Generation): Promise<void> {
    try {
      if (generation.shape === "sync") {
        const outputs = await generation.result;
        if (job.state !== "running") return;
        await this.#store(job, outputs);
        return;
      }

      let attempt = 0;
      for (;;) {
        if (job.state !== "queued" && job.state !== "running") return;
        if (this.#now() - job.startedAt > this.#maxDurationMs) {
          this.#fail(job, "The generation took longer than Studio waits for one.");
          if (generation.job.cancel !== undefined) {
            await generation.job.cancel().catch(() => undefined);
          }
          return;
        }

        const outcome = await generation.job.poll();
        if (job.state !== "queued" && job.state !== "running") return;

        switch (outcome.state) {
          case "queued":
          case "running":
            job.state = outcome.state;
            // The last word the vendor gave stands until it gives another:
            // a poll that says only "running" is not news that the earlier
            // progress line was wrong.
            job.detail = outcome.detail ?? job.detail;
            break;
          case "failed":
            this.#fail(job, outcome.message);
            return;
          case "done":
            job.state = "running";
            await this.#store(job, outcome.outputs);
            return;
        }

        const interval = this.#intervals[Math.min(attempt, this.#intervals.length - 1)] ?? 5_000;
        attempt += 1;
        await this.#sleep(interval);
      }
    } catch (error) {
      if (job.state === "queued" || job.state === "running") {
        this.#fail(job, error instanceof Error ? error.message : String(error));
      }
    }
  }

  async #store(job: Job, outputs: readonly MediaBytes[]): Promise<void> {
    if (outputs.length === 0) {
      this.#fail(job, "The provider finished without producing anything.");
      return;
    }
    const directory = this.#artifactsDirectory(job.conversationId);
    await mkdir(directory, { recursive: true });
    const written: MediaJobOutput[] = [];
    for (const [index, output] of outputs.entries()) {
      const fileName = `${job.id}-${String(index + 1)}.${extensionOf(output.mimeType)}`;
      const path = join(directory, fileName);
      await writeFile(path, output.bytes);
      written.push({
        path,
        fileName,
        mimeType: output.mimeType,
        byteLength: output.bytes.byteLength,
      });
    }
    // A stop that arrived while the files were being written wins: the
    // files stay on disk, harmlessly, and the job reads as stopped.
    if (job.state !== "running") return;
    job.outputs = written;
    this.#end(job, "done");
  }

  #fail(job: Job, message: string): void {
    job.error = message;
    this.#end(job, "failed");
  }

  #end(job: Job, state: MediaJobState): void {
    job.state = state;
    job.endedAt = this.#now();
    job.settle();
    // Fired while the job still reads untold, so whoever hears the news is
    // the one whose drain delivers it - the same arbiter the tool-result
    // tail and the next turn's block drain through, and exactly one of the
    // three tells the model.
    for (const listener of this.#endListeners) listener(job.conversationId);
  }
}

function statusOf(job: Job): MediaJobStatus {
  return {
    id: job.id,
    conversationId: job.conversationId,
    slot: job.slot,
    description: job.description,
    modelId: job.modelId,
    state: job.state,
    detail: job.detail,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    outputs: [...job.outputs],
    ...(job.error === undefined ? {} : { error: job.error }),
  };
}
