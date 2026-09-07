import { afterEach, describe, expect, it } from "vitest";

import { BackgroundJobs, finishedNotice, type JobStatus } from "../../src/process/background.js";

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

/**
 * The half that makes a background job something other than a thing to poll.
 *
 * A job that ends while nobody is looking has to keep that fact until there is
 * somewhere to put it, and then say it exactly once. Said twice it reads as
 * two jobs ending; said never it is a download the model waits on forever.
 */
describe("telling the caller a job has ended", () => {
  /** A program that ends on its own, the way a download does. */
  function brief(code = 0): readonly string[] {
    return ["-e", `console.log('done'); process.exit(${code})`];
  }

  it("says nothing while the job is still running", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: server(),
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });
    await settles(started.id, (job) => job.output.includes("listening"));

    // Running is not news. It is the state the caller asked for.
    expect(jobs.drainFinished("cnv_1")).toEqual([]);
  });

  it("reports an ended job once, and not a second time", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: brief(),
      cwd: process.cwd(),
      command: "node download",
      conversationId: "cnv_1",
    });
    await settles(started.id, (job) => job.state === "exited");

    const first = jobs.drainFinished("cnv_1");
    expect(first.map((job) => job.id)).toEqual([started.id]);
    expect(first[0]?.exitCode).toBe(0);
    // The drain is the delivery. A second read of the same ending would put
    // the same job in front of the model twice.
    expect(jobs.drainFinished("cnv_1")).toEqual([]);
  });

  it("records when a job ended, so a reader can tell fresh news from old", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: brief(3),
      cwd: process.cwd(),
      command: "node failing",
      conversationId: "cnv_1",
    });
    const ended = await settles(started.id, (job) => job.state === "exited");
    expect(ended.exitCode).toBe(3);
    expect(ended.endedAt).toBeTypeOf("number");
  });

  it("does not report a job the person stopped by hand", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: server(),
      cwd: process.cwd(),
      command: "node server",
      conversationId: "cnv_1",
    });
    jobs.stop("cnv_1", started.id);

    // Somebody was already watching. Telling them what they just did is noise.
    expect(jobs.drainFinished("cnv_1")).toEqual([]);
  });

  it("keeps one conversation's endings out of another's", async () => {
    jobs = new BackgroundJobs();
    const started = jobs.start({
      executable: NODE,
      args: brief(),
      cwd: process.cwd(),
      command: "node download",
      conversationId: "cnv_1",
    });
    await settles(started.id, (job) => job.state === "exited");

    expect(jobs.drainFinished("cnv_2")).toEqual([]);
    expect(jobs.drainFinished("cnv_1")).toHaveLength(1);
  });

  it("gives each run its own ids, so a remembered one cannot land on a new job", () => {
    const first = new BackgroundJobs();
    const second = new BackgroundJobs();
    const a = first.start({
      executable: NODE,
      args: brief(),
      cwd: process.cwd(),
      command: "node one",
      conversationId: "cnv_1",
    });
    const b = second.start({
      executable: NODE,
      args: brief(),
      cwd: process.cwd(),
      command: "node two",
      conversationId: "cnv_1",
    });
    first.stopAll();
    second.stopAll();

    // The registry is in memory, so a restart empties it - but the counter
    // starting over would let `job_1` from before the restart name whatever
    // ran first afterwards.
    expect(a.id).not.toBe(b.id);
  });
});

/**
 * What the notice says, which is a prompt decision and not a formatting one.
 *
 * It arrives somewhere the model did not ask for it - stapled to an unrelated
 * tool result, or in the environment block - so it has to say which job, how it
 * ended, and where to look, in that order, and then stop.
 */
describe("the wording of the ending notice", () => {
  it("says nothing when nothing ended", () => {
    expect(finishedNotice([])).toBeUndefined()
  })

  it("names the job, how it ended, and where the output is", async () => {
    jobs = new BackgroundJobs()
    const started = jobs.start({
      executable: NODE,
      args: ["-e", "console.log('done')"],
      cwd: process.cwd(),
      command: "node download",
      conversationId: "cnv_1",
    })
    await settles(started.id, (job) => job.state === "exited")

    const notice = finishedNotice(jobs.drainFinished("cnv_1")) ?? ""
    expect(notice).toContain(started.id)
    expect(notice).toContain("node download")
    // Without this a model told a download finished goes looking for the file
    // by hand rather than reading what the command printed.
    expect(notice).toContain("jobs tool")
    // The output itself is not in it. A notice that takes over the result it
    // was appended to is worse than no notice.
    expect(notice).not.toContain("done")
  })
})
