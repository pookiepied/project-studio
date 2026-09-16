import { describe, expect, it } from "vitest";

import { JobPings, type JobPingSource } from "../../src/process/job-pings.js";

/**
 * The one place a finished background job becomes a message.
 *
 * The hub owns the decision to deliver and the message's shape; the
 * registries own the exactly-once marker, through their drains. What is
 * pinned here is that bargain from the hub's side: it collects from every
 * source, delivers what it collected, keeps silent when it collected nothing,
 * and neither throws nor closes the channel when a delivery fails.
 */

interface Harness {
  readonly pings: JobPings;
  /** Everything this harness's port received, oldest first. */
  readonly deliveries: { conversationId: string; body: string }[];
  /** Puts a source behind the hub. */
  readonly addSource: (source: JobPingSource) => void;
  /** Makes the next delivery fail, the way an unreachable harness does. */
  readonly failNextDelivery: (reason: unknown) => void;
}

function harness(): Harness {
  const deliveries: { conversationId: string; body: string }[] = [];
  let nextFailure: unknown;
  const pings = new JobPings({
    deliver: async (conversationId, body) => {
      if (nextFailure !== undefined) {
        const reason = nextFailure;
        nextFailure = undefined;
        throw reason;
      }
      deliveries.push({ conversationId, body });
    },
    exists: (conversationId) => conversationId !== "cnv_gone",
    onFailure: (reason) => {
      // Recorded beside the deliveries, so the test reads successes and
      // failures off one list: a failure reaches this port or nowhere at all.
      deliveries.push({
        conversationId: "<failure>",
        body: reason instanceof Error ? reason.message : String(reason),
      });
    },
  });
  return {
    pings,
    deliveries,
    addSource: (source) => pings.addSource(source),
    failNextDelivery: (reason) => {
      nextFailure = reason;
    },
  };
}

describe("a finished background job's announcement", () => {
  it("delivers the conversation's collected lines as one message", () => {
    const h = harness();
    h.addSource({ drain: (id) => (id === "cnv_one" ? ["job_a1 exited 0: npm run build"] : []) });
    h.addSource({ drain: (id) => (id === "cnv_one" ? ["media_b2 finished: a helmet"] : []) });

    h.pings.announce("cnv_one");

    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]?.conversationId).toBe("cnv_one");
    // Both sources, in the order they were added, with the framing that says
    // who is speaking - the model must be able to tell this from a user's
    // words without anyone there to tell it.
    expect(h.deliveries[0]?.body).toBe(
      [
        "Background work has finished:",
        "job_a1 exited 0: npm run build",
        "media_b2 finished: a helmet",
        "",
        "This message is the harness, not the user: reply with the outcome, briefly.",
      ].join("\n"),
    );
  });

  it("delivers an ending once, however many times it is announced", () => {
    const h = harness();
    let told = false;
    h.addSource({
      // A source that yields once and then reports it told: the second
      // announce of the same ending is the ordinary race, not a bug, and its
      // answer is silence.
      drain: (id) => {
        if (id !== "cnv_drained" || told) return [];
        told = true;
        return ["media_c3 finished: a bicycle"];
      },
    });

    h.pings.announce("cnv_drained");
    h.pings.announce("cnv_drained");

    expect(h.deliveries).toHaveLength(1);
  });

  it("answers an ending for a conversation that no longer exists with silence", () => {
    const h = harness();
    h.addSource({ drain: (id) => (id === "cnv_gone" ? ["job_d4 finished: npm test"] : []) });

    // The row was purged; the ending has no reader. Announced anyway - the
    // registry cannot know - and neither collected nor delivered.
    h.pings.announce("cnv_gone");

    expect(h.deliveries).toEqual([]);
  });

  it("reports a failed delivery and keeps announcing after it", async () => {
    const h = harness();
    h.addSource({ drain: (id) => (id === "cnv_fail" ? ["job_e5 failed: no such connection"] : []) });
    h.failNextDelivery(new Error("the instance was never mounted"));

    expect(() => h.pings.announce("cnv_fail")).not.toThrow();
    // The failure is reported when the delivery's promise settles, which is
    // the microtask after this line - the hub neither throws nor blocks on it.
    await Promise.resolve();
    expect(h.deliveries[0]?.conversationId).toBe("<failure>");
    expect(h.deliveries[0]?.body).toContain("never mounted");

    // The next ending still goes out: one lost delivery must not close the
    // channel.
    h.pings.announce("cnv_fail");
    await Promise.resolve();
    expect(h.deliveries[1]?.conversationId).toBe("cnv_fail");
  });

  it("scopes the collection to the conversation that ended something", () => {
    const h = harness();
    const source: JobPingSource = {
      drain: (id) => (id === "cnv_second" ? ["job_f6 exited 2: npm run other"] : []),
    };
    h.addSource(source);

    h.pings.announce("cnv_first");
    expect(h.deliveries).toEqual([]);

    h.pings.announce("cnv_second");
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]?.conversationId).toBe("cnv_second");
  });
});
