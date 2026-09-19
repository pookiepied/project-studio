import { describe, expect, it } from "vitest";

import { compactConversation, compactionReadiness } from "../../src/conversations/compaction.js";
import type { ConversationUsage } from "../../src/conversations/context-usage.js";
import { StorageError } from "../../src/storage/errors.js";

/**
 * Compacting by hand: the cool-down that refuses a pointless compaction,
 * and the door that runs a wanted one.
 */

function usage(total: number, estimated = false): ConversationUsage {
  return { input: total, cacheRead: 0, cacheWrite: 0, output: 0, observedAt: 1, estimated };
}

const KNOWN = { contextWindow: 200_000, maxOutputTokens: 64_000 } as const;
const UNKNOWN = { contextWindow: "unknown", maxOutputTokens: "unknown" } as const;

describe("compactionReadiness", () => {
  it("refuses a conversation no turn has measured", () => {
    expect(compactionReadiness(undefined, KNOWN)).toMatchObject({ available: false });
  });

  it("refuses until a measured turn has followed the last compaction", () => {
    // The row a compaction writes is an estimate; a second press over it
    // would summarise a summary.
    const refused = compactionReadiness(usage(180_000, true), KNOWN);
    expect(refused.available).toBe(false);
    if (!refused.available) expect(refused.reason).toMatch(/Already compacted/);
  });

  it("refuses below a share of a known window, and says how full it is", () => {
    const refused = compactionReadiness(usage(24_000), KNOWN);
    expect(refused).toEqual({
      available: false,
      reason: "Nothing to compact yet: the conversation is 12% full.",
    });
    expect(compactionReadiness(usage(60_000), KNOWN)).toEqual({ available: true });
  });

  it("falls back to a flat count when the window is unknown", () => {
    expect(compactionReadiness(usage(12_000), UNKNOWN)).toMatchObject({ available: false });
    expect(compactionReadiness(usage(30_000), UNKNOWN)).toEqual({ available: true });
  });
});

describe("compactConversation", () => {
  it("refuses under the cool-down without touching the door", async () => {
    let opened = 0;
    await expect(
      compactConversation("cnv_1", {
        agent: () => undefined,
        usage: usage(10_000),
        limits: KNOWN,
        door: () => {
          opened += 1;
          return Promise.resolve();
        },
      }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(opened).toBe(0);
  });

  it("opens the door with the agent and the conversation id", async () => {
    const calls: unknown[][] = [];
    const agent = () => undefined;
    await compactConversation("cnv_1", {
      agent,
      usage: usage(100_000),
      limits: KNOWN,
      door: (...args) => {
        calls.push(args);
        return Promise.resolve();
      },
    });
    expect(calls).toEqual([[agent, "cnv_1"]]);
  });

  it("turns the runtime's busy refusal into a conflict with a plain sentence", async () => {
    const busy = Object.assign(new Error('Session "default" is busy running prompt.'), {
      name: "SessionBusyError",
      type: "session_busy",
    });
    await expect(
      compactConversation("cnv_1", {
        agent: () => undefined,
        usage: usage(100_000),
        limits: KNOWN,
        door: () => Promise.reject(busy),
      }),
    ).rejects.toMatchObject({ kind: "conflict", message: /Finish or stop the run first/ });
  });

  it("says so when the runtime has no door", async () => {
    const held = globalThis.__projectStudioCompactAgentInstance;
    globalThis.__projectStudioCompactAgentInstance = undefined;
    try {
      await expect(
        compactConversation("cnv_1", { agent: () => undefined, usage: usage(100_000), limits: KNOWN }),
      ).rejects.toMatchObject({ kind: "unavailable" });
    } finally {
      globalThis.__projectStudioCompactAgentInstance = held;
    }
  });
});
