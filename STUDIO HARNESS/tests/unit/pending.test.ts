import { describe, expect, it } from "vitest";

import { PendingRequests } from "../../src/extend/mcp/wire/pending.js";

describe("pending requests", () => {
  describe("issuing ids", () => {
    it("issues incrementing unique ids", () => {
      const pending = new PendingRequests();
      expect(pending.nextId()).toBe(1);
      expect(pending.nextId()).toBe(2);
      expect(pending.nextId()).toBe(3);
    });

    it("never reuses an id after it has been settled", async () => {
      const pending = new PendingRequests();
      const id1 = pending.nextId();
      const promise = pending.register(id1);
      pending.resolve(id1, "a");
      await promise;
      expect(pending.nextId()).toBe(2);
      expect(pending.nextId()).toBe(3);
    });

    it("never reuses an id after rejectAll", async () => {
      const pending = new PendingRequests();
      const id1 = pending.nextId();
      const promise = pending.register(id1);
      pending.rejectAll(new Error("dead"));
      await expect(promise).rejects.toThrow("dead");
      expect(pending.nextId()).toBe(2);
    });
  });

  describe("register and settle", () => {
    it("registers a pending request and reports how many are outstanding", () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id);
      expect(pending.size).toBe(1);
      // Avoid unhandled rejection — settle it.
      pending.resolve(id, "x");
      return expect(promise).resolves.toBe("x");
    });

    it("resolves on result and removes the entry", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id);
      pending.resolve(id, { ok: 1 });
      await expect(promise).resolves.toEqual({ ok: 1 });
      expect(pending.size).toBe(0);
    });

    it("rejects on error and removes the entry", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id);
      pending.reject(id, new Error("boom"));
      await expect(promise).rejects.toThrow("boom");
      expect(pending.size).toBe(0);
    });

    it("rejects when the id is already pending", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id);
      expect(() => pending.register(id)).toThrow();
      pending.rejectAll(new Error("cleanup"));
      await expect(promise).rejects.toThrow("cleanup");
      expect(pending.size).toBe(0);
    });

    it("accepts a string id", async () => {
      const pending = new PendingRequests();
      const promise = pending.register("my-id");
      pending.resolve("my-id", 123);
      await expect(promise).resolves.toBe(123);
      expect(pending.size).toBe(0);
    });
  });

  describe("unknown ids", () => {
    it("ignores a response for an unknown id", () => {
      const pending = new PendingRequests();
      expect(pending.resolve(999, "late")).toBe(false);
      expect(pending.reject(999, new Error("late"))).toBe(false);
      expect(pending.size).toBe(0);
    });

    it("ignores a late response for something already timed out", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id, { timeoutMs: 5 });
      await expect(promise).rejects.toThrow(/did not answer in time/);
      expect(pending.size).toBe(0);
      // Late arrival — must not throw and must not re-add an entry.
      expect(pending.resolve(id, "late")).toBe(false);
      expect(pending.size).toBe(0);
    });

    it("ignores a late response for something already aborted", async () => {
      const pending = new PendingRequests();
      const controller = new AbortController();
      const id = pending.nextId();
      const promise = pending.register(id, { signal: controller.signal });
      controller.abort(new Error("aborted"));
      await expect(promise).rejects.toThrow("aborted");
      expect(pending.size).toBe(0);
      expect(pending.resolve(id, "late")).toBe(false);
      expect(pending.size).toBe(0);
    });
  });

  describe("timeout", () => {
    it("rejects and removes the entry on timeout", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id, { timeoutMs: 10 });
      await expect(promise).rejects.toThrow(/did not answer in time/);
      expect(pending.size).toBe(0);
    });

    it("times each request out on its own deadline", async () => {
      const pending = new PendingRequests();
      const id1 = pending.nextId();
      const id2 = pending.nextId();
      const p1 = pending.register(id1, { timeoutMs: 10 });
      const p2 = pending.register(id2, { timeoutMs: 50 });
      expect(pending.size).toBe(2);
      await expect(p1).rejects.toThrow(/did not answer in time/);
      expect(pending.size).toBe(1);
      pending.resolve(id2, "ok");
      await expect(p2).resolves.toBe("ok");
      expect(pending.size).toBe(0);
    });

    it("clears the timeout when the response arrives first", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id, { timeoutMs: 50 });
      pending.resolve(id, "fast");
      await expect(promise).resolves.toBe("fast");
      expect(pending.size).toBe(0);
      // Wait past the original deadline — no second rejection.
      await new Promise((r) => setTimeout(r, 60));
      expect(pending.size).toBe(0);
    });
  });

  describe("AbortSignal", () => {
    it("rejects and removes the entry when aborted", async () => {
      const pending = new PendingRequests();
      const controller = new AbortController();
      const id = pending.nextId();
      const promise = pending.register(id, { signal: controller.signal });
      controller.abort(new Error("user aborted"));
      await expect(promise).rejects.toThrow("user aborted");
      expect(pending.size).toBe(0);
    });

    it("supports an abort with no reason", async () => {
      const pending = new PendingRequests();
      const controller = new AbortController();
      const id = pending.nextId();
      const promise = pending.register(id, { signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow();
      expect(pending.size).toBe(0);
    });

    it("rejects immediately if the signal is already aborted", async () => {
      const pending = new PendingRequests();
      const controller = new AbortController();
      controller.abort(new Error("already"));
      const id = pending.nextId();
      const promise = pending.register(id, { signal: controller.signal });
      await expect(promise).rejects.toThrow("already");
      expect(pending.size).toBe(0);
    });

    it("clears the abort handler when the response arrives first", async () => {
      const pending = new PendingRequests();
      const controller = new AbortController();
      const id = pending.nextId();
      const promise = pending.register(id, { signal: controller.signal });
      pending.resolve(id, "ok");
      await expect(promise).resolves.toBe("ok");
      expect(pending.size).toBe(0);
      // Aborting after settlement must not affect the map or throw.
      controller.abort(new Error("late abort"));
      expect(pending.size).toBe(0);
    });

    it("aborts one request without affecting another", async () => {
      const pending = new PendingRequests();
      const c1 = new AbortController();
      const c2 = new AbortController();
      const id1 = pending.nextId();
      const id2 = pending.nextId();
      const p1 = pending.register(id1, { signal: c1.signal });
      const p2 = pending.register(id2, { signal: c2.signal });
      c1.abort(new Error("one"));
      await expect(p1).rejects.toThrow("one");
      expect(pending.size).toBe(1);
      pending.resolve(id2, "two");
      await expect(p2).resolves.toBe("two");
      expect(pending.size).toBe(0);
    });
  });

  describe("rejectAll", () => {
    it("settles everything outstanding and empties the map", async () => {
      const pending = new PendingRequests();
      const id1 = pending.nextId();
      const id2 = pending.nextId();
      const p1 = pending.register(id1);
      const p2 = pending.register(id2);
      expect(pending.size).toBe(2);
      pending.rejectAll(new Error("connection died"));
      await expect(p1).rejects.toThrow("connection died");
      await expect(p2).rejects.toThrow("connection died");
      expect(pending.size).toBe(0);
    });

    it("rejects with the given reason", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id);
      const reason = new Error("gone");
      pending.rejectAll(reason);
      await expect(promise).rejects.toBe(reason);
      expect(pending.size).toBe(0);
    });

    it("empties the map even when there is nothing pending", () => {
      const pending = new PendingRequests();
      pending.rejectAll(new Error("gone"));
      expect(pending.size).toBe(0);
    });

    it("clears timeouts so they do not fire after rejectAll", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const promise = pending.register(id, { timeoutMs: 20 });
      pending.rejectAll(new Error("dead"));
      await expect(promise).rejects.toThrow("dead");
      expect(pending.size).toBe(0);
      await new Promise((r) => setTimeout(r, 30));
      expect(pending.size).toBe(0);
    });

    it("clears abort handlers so a later abort does not re-add", async () => {
      const pending = new PendingRequests();
      const controller = new AbortController();
      const id = pending.nextId();
      const promise = pending.register(id, { signal: controller.signal });
      pending.rejectAll(new Error("dead"));
      await expect(promise).rejects.toThrow("dead");
      expect(pending.size).toBe(0);
      controller.abort(new Error("late"));
      expect(pending.size).toBe(0);
    });
  });

  describe("map is empty after every terminal path", () => {
    it("after resolve", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const p = pending.register(id);
      pending.resolve(id, 1);
      await p;
      expect(pending.size).toBe(0);
    });

    it("after reject", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const p = pending.register(id);
      pending.reject(id, new Error("e"));
      await expect(p).rejects.toThrow("e");
      expect(pending.size).toBe(0);
    });

    it("after timeout", async () => {
      const pending = new PendingRequests();
      const id = pending.nextId();
      const p = pending.register(id, { timeoutMs: 5 });
      await expect(p).rejects.toThrow();
      expect(pending.size).toBe(0);
    });

    it("after abort", async () => {
      const pending = new PendingRequests();
      const c = new AbortController();
      const id = pending.nextId();
      const p = pending.register(id, { signal: c.signal });
      c.abort();
      await expect(p).rejects.toThrow();
      expect(pending.size).toBe(0);
    });

    it("after rejectAll", async () => {
      const pending = new PendingRequests();
      const p1 = pending.register(pending.nextId());
      const p2 = pending.register(pending.nextId());
      pending.rejectAll(new Error("x"));
      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
      expect(pending.size).toBe(0);
    });
  });
});

/**
 * Several MCP calls in flight at once.
 *
 * A model may return several tool calls in one assistant message, and when
 * more than one of them belongs to the same MCP server they travel one
 * connection - one pipe, one process, several questions outstanding. The only
 * thing keeping those answers apart is the request id, because a server is
 * free to answer them in whatever order it finishes.
 *
 * The failure this guards against is the quiet one. Correlate wrongly and
 * every call still resolves, so the batch looks like it worked; one tool
 * simply receives another tool's answer. That is worse than an error, because
 * the model reads the result as its own and carries on.
 */
describe("several requests outstanding at once", () => {
  it("gives each caller its own answer when the server replies out of order", () => {
    const pending = new PendingRequests();
    const first = pending.nextId();
    const second = pending.nextId();
    const third = pending.nextId();

    const waiting = [
      pending.register(first),
      pending.register(second),
      pending.register(third),
    ];
    expect(pending.size).toBe(3);

    // Answered back to front, which a server is entitled to do: the third
    // call may be a fast read while the first is a slow search.
    pending.resolve(third, "third");
    pending.resolve(first, "first");
    pending.resolve(second, "second");

    expect(pending.size).toBe(0);
    return expect(Promise.all(waiting)).resolves.toEqual(["first", "second", "third"]);
  });

  it("fails one outstanding request without disturbing the others", async () => {
    const pending = new PendingRequests();
    const failing = pending.nextId();
    const fine = pending.nextId();

    const failingPromise = pending.register(failing);
    const finePromise = pending.register(fine);

    pending.reject(failing, new Error("server said no"));
    pending.resolve(fine, "ok");

    // One tool call in a batch failing is ordinary. It must not take its
    // siblings down with it, or a single bad call would lose every answer
    // that shared its connection.
    await expect(failingPromise).rejects.toThrow("server said no");
    await expect(finePromise).resolves.toBe("ok");
  });
});
