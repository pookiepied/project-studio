import { afterEach, describe, expect, it } from "vitest";

import { BackgroundJobs, type JobStatus } from "../../src/process/background.js";

/**
 * Commands that are not meant to finish.
 *
 * `runProcess` resolves on the child's `close`, which waits for the process to
 * exit and for every pipe it handed a descendant to close. A dev server does
 * neither, so asking for one held the call until the timeout and then threw
 * the output away with the failure. Detaching inside the command line does not
 * help: the grandchild inherits the same pipes.
 *
 * What is pinned here is that starting does not wait, that the output can be
 * read afterwards, that a job can be ended, and that one conversation cannot
 * see or stop another's.
 */

const NODE = process.execPath;

let jobs: BackgroundJobs;

afterEach(() => {
  jobs?.stopAll();
});

/** A program that prints and then stays up, the way a server does. */
function server(): readonly string[] {
  return ["-e", "console.log('listening on 3000'); setInterval(() => {}, 1000)"];
}

async function settles(id: string, until: (job: JobStatus) => boolean): Promise<JobStatus> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = jobs.get("cnv_1", id);
    if (job !== undefined && until(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${id} never reached the expected state`);
}

describe("a command started in the background", () => {
  it("returns while it is still running", () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: server(),
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });

    // The whole feature in one assertion: this call returned, and the thing it
    // started is still going.
    expect(started.state).toBe("running");
    expect(started.id).toMatch(/^job_/);
  });

  it("keeps the output for reading later", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: server(),
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });

    const job = await settles(started.id, (candidate) => candidate.output.includes("listening"));
    expect(job.output).toContain("listening on 3000");
    expect(job.state).toBe("running");
  });

  it("shows a line the process never terminated", async () => {
    // A server that prints its port without a trailing newline and then waits
    // is exactly when the output matters most, and holding the line back until
    // a newline that never comes would show nothing at all.
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });

    const job = await settles(started.id, (candidate) => candidate.output.includes("ready"));
    expect(job.output).toBe("ready");
  });

  it("records how a short command ended", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: ["-e", "process.exit(3)"],
      cwd: process.cwd(),
      command: "node -e exit",
      conversationId: "cnv_1",
    });

    const job = await settles(started.id, (candidate) => candidate.state !== "running");
    expect(job.state).toBe("exited");
    expect(job.exitCode).toBe(3);
  });

  it("stops one when it is asked to", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: server(),
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });

    expect(jobs.stop("cnv_1", started.id)).toBe(true);
    expect(jobs.get("cnv_1", started.id)?.state).toBe("stopped");
  });

  it("keeps one conversation's jobs out of another's reach", () => {
    // The id is guessable, and a job is a live process. A conversation must
    // not be able to read or end one it did not start.
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: server(),
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });

    expect(jobs.get("cnv_2", started.id)).toBeUndefined();
    expect(jobs.stop("cnv_2", started.id)).toBe(false);
    expect(jobs.list("cnv_2")).toEqual([]);
    expect(jobs.get("cnv_1", started.id)?.state).toBe("running");
  });

  it("keeps a bounded tail and says what it dropped", async () => {
    // A server left up for an hour writes more than anyone reads. The last
    // screenful is what is wanted; a tail that silently begins mid-stream
    // would read as the whole of the output.
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: ["-e", "for (let i = 0; i < 1000; i += 1) console.log('line ' + i);"],
      cwd: process.cwd(),
      command: "node noisy",
      conversationId: "cnv_1",
    });

    const job = await settles(started.id, (candidate) => candidate.state !== "running");
    expect(job.dropped).toBeGreaterThan(0);
    expect(job.output).toContain("line 999");
    expect(job.output).not.toContain("line 0\n");
  });
})
