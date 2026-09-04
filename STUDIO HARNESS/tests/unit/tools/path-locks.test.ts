import { describe, expect, it } from "vitest";

import { PathLocks, pathKey } from "../../../src/tools/filesystem/access-log.js";

/**
 * The lock that makes parallel tool calls safe.
 *
 * A model may return several tool calls in one assistant message, and they are
 * dispatched together rather than one after another. That is the point of it -
 * three reads of three files should not cost three round trips - but it means
 * two calls can be inside `write` or `edit` on the same file at the same
 * instant. Edit is read-modify-write, so without serialization both calls read
 * the same original, both write, and the second silently discards the first.
 * The model is told both succeeded.
 *
 * `PathLocks` is what stops that, and until this file nothing tested it. The
 * mechanism deserves tests rather than trust, because it fails silently and in
 * the one direction nobody checks: the happy path still returns "ok" from both
 * calls.
 *
 * The tests below pin the three properties the tools depend on - same path
 * waits, different paths do not, and a failure does not poison the queue -
 * using explicit deferred promises rather than timers, so they assert ordering
 * rather than racing a clock.
 */

/** A promise with its settle functions, so a test can decide when work ends. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolveIn, rejectIn) => {
    resolve = resolveIn;
    reject = rejectIn;
  });
  return { promise, resolve, reject };
}

/** Lets every already-resolved microtask run before the assertion reads state. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("PathLocks", () => {
  it("holds the second caller on a path until the first has finished", async () => {
    const locks = new PathLocks();
    const first = deferred<string>();
    const started: string[] = [];

    const one = locks.run("/w/app.ts", async () => {
      started.push("one");
      return first.promise;
    });
    const two = locks.run("/w/app.ts", async () => {
      started.push("two");
      return "two";
    });

    await settle();
    // The second call's work has not begun. This is the whole guarantee: were
    // it running, it would already have read the file the first call is about
    // to rewrite.
    expect(started).toEqual(["one"]);

    first.resolve("one");
    await expect(one).resolves.toBe("one");
    await expect(two).resolves.toBe("two");
    expect(started).toEqual(["one", "two"]);
  });

  it("lets different paths run at the same time", async () => {
    const locks = new PathLocks();
    const held = deferred<string>();
    const started: string[] = [];

    const app = locks.run("/w/app.ts", async () => {
      started.push("app");
      return held.promise;
    });
    const readme = locks.run("/w/README.md", async () => {
      started.push("readme");
      return "readme";
    });

    await settle();
    // Both are inside their work while neither has finished. Serializing every
    // path would be safe and would also throw away the reason tool calls are
    // dispatched together in the first place.
    expect(started).toEqual(["app", "readme"]);
    await expect(readme).resolves.toBe("readme");

    held.resolve("app");
    await expect(app).resolves.toBe("app");
  });

  it("runs the next caller after the one before it threw", async () => {
    const locks = new PathLocks();
    const first = deferred<string>();
    const started: string[] = [];

    const failing = locks.run("/w/app.ts", async () => {
      started.push("failing");
      return first.promise;
    });
    const following = locks.run("/w/app.ts", async () => {
      started.push("following");
      return "following";
    });

    await settle();
    first.reject(new Error("disk full"));

    // The failure belongs to its own caller and to nobody else: a write that
    // could not be made must not take the next write down with it, or one bad
    // call in a parallel batch would strand every later call on that file.
    await expect(failing).rejects.toThrow("disk full");
    await expect(following).resolves.toBe("following");
    expect(started).toEqual(["failing", "following"]);
  });

  it("frees a path once its last caller is out", async () => {
    const locks = new PathLocks();
    // The chain entry is released by whoever leaves last. If it were not, the
    // map would grow for every file a long conversation has ever touched, and
    // - the part that would actually be noticed - a settled predecessor would
    // still be sitting in front of the next call on that path.
    for (let index = 0; index < 50; index += 1) {
      await locks.run(`/w/file-${index}.ts`, async () => index);
    }

    const started: string[] = [];
    const held = deferred<number>();
    const again = locks.run("/w/file-0.ts", async () => {
      started.push("again");
      return held.promise;
    });
    // Immediately, without awaiting anything: a stale chain would hold this
    // back behind a promise that resolved long ago.
    await settle();
    expect(started).toEqual(["again"]);

    held.resolve(0);
    await expect(again).resolves.toBe(0);
  });
});

describe("pathKey", () => {
  it("matches the platform's own idea of the same file", () => {
    // Windows opens `SRC/App.ts` and `src/app.ts` as one file, so the lock has
    // to treat them as one key or two concurrent edits of the same file would
    // each take a different lock and neither would wait.
    if (process.platform === "win32") {
      expect(pathKey("C:\\W\\SRC\\App.ts")).toBe(pathKey("c:\\w\\src\\app.ts"));
    } else {
      expect(pathKey("/w/src/App.ts")).not.toBe(pathKey("/w/src/app.ts"));
    }
  });
});
