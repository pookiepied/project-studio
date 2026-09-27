import { describe, expect, it } from "vitest";

import {
  compactConversation,
  compactionReadiness,
  coolDownTokensFor,
} from "../../src/conversations/compaction.js";
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
const MILLION = { contextWindow: 1_000_000, maxOutputTokens: 200_000 } as const;
const SMALL = { contextWindow: 32_000, maxOutputTokens: 8_000 } as const;
const UNKNOWN = { contextWindow: "unknown", maxOutputTokens: "unknown" } as const;

describe("coolDownTokensFor", () => {
  it("is the flat 30k wherever 30% of the window would be more", () => {
    expect(coolDownTokensFor(MILLION)).toBe(30_000);
    expect(coolDownTokensFor(KNOWN)).toBe(30_000);
    expect(coolDownTokensFor({ contextWindow: 100_000, maxOutputTokens: 32_000 })).toBe(30_000);
  });

  it("is the share of the window where that is smaller, so the button exists at all", () => {
    expect(coolDownTokensFor(SMALL)).toBe(9_600);
    expect(coolDownTokensFor({ contextWindow: 8_192, maxOutputTokens: 4_096 })).toBe(2_457);
  });

  it("is the flat 30k with no window to compare against", () => {
    expect(coolDownTokensFor(UNKNOWN)).toBe(30_000);
  });
});

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

  it("folds from the flat 30k on a million-token window, not from 30% of it", () => {
    // The rule this replaced held the button behind 300k tokens on this
    // model and answered "10% full" to a conversation of 100k.
    expect(compactionReadiness(usage(12_000), MILLION)).toEqual({
      available: false,
      reason: "Nothing to compact yet: the conversation is 12k tokens; folding starts at 30k.",
    });
    expect(compactionReadiness(usage(100_000), MILLION)).toEqual({ available: true });
  });

  it("refuses below the flat floor on a 200k window too, which used to ask 60k", () => {
    expect(compactionReadiness(usage(24_000), KNOWN)).toEqual({
      available: false,
      reason: "Nothing to compact yet: the conversation is 24k tokens; folding starts at 30k.",
    });
    expect(compactionReadiness(usage(30_000), KNOWN)).toEqual({ available: true });
    // The old 30% boundary still passes, as it should.
    expect(compactionReadiness(usage(60_000), KNOWN)).toEqual({ available: true });
  });

  it("never rounds the refusal up to the bar it refuses against", () => {
    // 29,999 reads as 29k, not 30k: a sentence that said "30k of the 30k"
    // would argue with itself.
    const refused = compactionReadiness(usage(29_999), MILLION);
    expect(refused.available).toBe(false);
    if (!refused.available) expect(refused.reason).toContain("29k tokens");
  });

  it("keeps the share of the window on a small one, where it is the smaller number", () => {
    const refused = compactionReadiness(usage(9_000), SMALL);
    expect(refused).toEqual({
      available: false,
      reason: "Nothing to compact yet: the conversation is 28% full.",
    });
    expect(compactionReadiness(usage(9_600), SMALL)).toEqual({ available: true });
  });

  it("falls back to the flat count when the window is unknown", () => {
    expect(compactionReadiness(usage(12_000), UNKNOWN)).toEqual({
      available: false,
      reason: "Nothing to compact yet: the conversation is 12k tokens; folding starts at 30k.",
    });
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
