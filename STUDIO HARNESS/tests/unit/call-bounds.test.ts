import { describe, expect, it } from "vitest";

import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../src/contracts/capabilities.js";
import { CallBounds } from "../../src/tools/bounds.js";
import { ToolError } from "../../src/tools/errors.js";

function capability(name: string, idempotent: boolean): CapabilityDescriptor {
  return {
    id: { namespace: "native", name },
    title: name,
    description: name,
    effects: ["read"],
    provenance: NATIVE_PROVENANCE,
    idempotent,
  };
}

const SAFE = capability("read", true);
const UNSAFE = capability("git", false);

/** A promise that never settles — the hang this whole module exists for. */
function forever(): Promise<never> {
  return new Promise(() => undefined);
}

function after(ms: number): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve("done"), ms));
}

async function failure(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    return error as ToolError;
  }
  throw new ToolError("internal", { message: "expected a failure" });
}

describe("deadlines", () => {
  it("abandons a call that never returns", async () => {
    const bounds = new CallBounds({ timeoutMs: 30 });

    const error = await failure(bounds.run(SAFE, undefined, () => forever()));

    expect(error).toBeInstanceOf(ToolError);
    expect(error.kind).toBe("timed_out");
  });

  it("lets a call that finishes in time through untouched", async () => {
    const bounds = new CallBounds({ timeoutMs: 500 });

    await expect(bounds.run(SAFE, undefined, () => after(10))).resolves.toBe("done");
  });

  it("takes a per-capability deadline over the default", () => {
    const bounds = new CallBounds({
      timeoutMs: 1_000,
      timeoutByCapability: { "native/git": 60_000 },
    });

    expect(bounds.deadlineFor(SAFE)).toBe(1_000);
    expect(bounds.deadlineFor(UNSAFE)).toBe(60_000);
  });
});

describe("what the model is told about an abandoned call", () => {
  // The distinction that matters is not why it ended but whether anything
  // happened, because that is what decides whether a retry is safe.

  it("says a repeat is safe when the call is idempotent", async () => {
    const bounds = new CallBounds({ timeoutMs: 20 });

    const error = await failure(bounds.run(SAFE, undefined, () => forever()));

    expect(error.message).toMatch(/running it again is safe/i);
  });

  it("says the outcome is unknown when it is not", async () => {
    const bounds = new CallBounds({ timeoutMs: 20 });

    const error = await failure(bounds.run(UNSAFE, undefined, () => forever()));

    expect(error.message).toMatch(/may or may not have finished/i);
    expect(error.message).toMatch(/check the current state/i);
  });

  it("says nothing was done when the call never left the queue", async () => {
    // Separate deadlines so the queued call expires while the blocking one is
    // still holding the permit. One shared deadline makes the two race.
    const bounds = new CallBounds({
      maxConcurrent: 1,
      timeoutByCapability: { "native/read": 5_000, "native/git": 30 },
    });
    const blocking = bounds.run(SAFE, undefined, () => after(300));

    // Non-idempotent, so a wrong answer here would tell the model its
    // uncompleted call might have happened.
    const error = await failure(bounds.run(UNSAFE, undefined, () => after(1)));

    expect(error.message).toMatch(/nothing was done/i);
    expect(error.message).toMatch(/running it again is safe/i);
    await blocking;
  });
});

describe("cancellation", () => {
  it("reaches the tool, so a call can stop partway through", async () => {
    const bounds = new CallBounds({ timeoutMs: 5_000 });
    const controller = new AbortController();
    let observed: boolean | undefined;

    const call = bounds.run(SAFE, controller.signal, async (signal) => {
      // What a real tool does: hand the signal to runProcess and be
      // interrupted. Here we just record that it arrived live.
      observed = signal.aborted;
      await forever();
      return "unreachable";
    });

    // Let the call actually start. Aborting synchronously would test the
    // already-cancelled path instead, which is a different case.
    await after(5);
    controller.abort();
    const error = await failure(call);

    expect(observed).toBe(false);
    expect(error.kind).toBe("cancelled");
  });

  it("is distinguished from a deadline", async () => {
    const bounds = new CallBounds({ timeoutMs: 20 });
    const controller = new AbortController();

    const error = await failure(bounds.run(SAFE, controller.signal, () => forever()));

    expect(error.kind).toBe("timed_out");
  });
});

describe("concurrency", () => {
  it("runs no more than the limit at once", async () => {
    const bounds = new CallBounds({ timeoutMs: 5_000, maxConcurrent: 2 });
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        bounds.run(SAFE, undefined, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await after(5);
          running -= 1;
          return "done";
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(bounds.inFlight).toEqual({ active: 0, queued: 0 });
  });

  it("admits waiting calls in turn", async () => {
    const bounds = new CallBounds({ timeoutMs: 5_000, maxConcurrent: 1 });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        bounds.run(SAFE, undefined, async () => {
          order.push(n);
          await after(1);
          return "done";
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it("does not leak a permit when a waiting call is abandoned", async () => {
    // The bug this guards against: a waiter that is rejected but left in the
    // queue is admitted later and holds a permit nobody releases, so the gate
    // deadlocks a few calls at a time and only under load.
    const bounds = new CallBounds({ timeoutMs: 5_000, maxConcurrent: 1 });
    const controller = new AbortController();

    const first = bounds.run(SAFE, undefined, () => after(30));
    const abandoned = bounds.run(SAFE, controller.signal, () => after(1));
    controller.abort();

    await failure(abandoned);
    await first;

    // The queue is empty and the permit came back, so this runs immediately.
    await expect(bounds.run(SAFE, undefined, () => after(1))).resolves.toBe("done");
    expect(bounds.inFlight).toEqual({ active: 0, queued: 0 });
  });

  it("releases the permit when a call throws", async () => {
    const bounds = new CallBounds({ timeoutMs: 5_000, maxConcurrent: 1 });

    await failure(
      bounds.run(SAFE, undefined, async () => {
        throw new ToolError("execution_failed");
      }),
    );

    expect(bounds.inFlight).toEqual({ active: 0, queued: 0 });
    await expect(bounds.run(SAFE, undefined, () => after(1))).resolves.toBe("done");
  });
});
