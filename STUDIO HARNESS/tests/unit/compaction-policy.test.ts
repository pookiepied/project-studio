import { describe, expect, it } from "vitest";

import {
  compactionConfigFor,
  compactionReserveFor,
  compactionThresholdFor,
} from "../../src/conversations/compaction-policy.js";
import { COMPACTION_PROMPTS } from "../../src/context/compaction-prompt.js";

/**
 * The reserve Studio hands Flue: a floor of 20k that grows to 15% of the
 * window, capped at what the model can write, and a third of a small window.
 */
describe("compactionReserveFor", () => {
  it("holds 15% back on a large window, so a 200k model compacts at 170k", () => {
    expect(compactionReserveFor({ contextWindow: 200_000, maxOutputTokens: 64_000 })).toBe(30_000);
    expect(compactionThresholdFor({ contextWindow: 200_000, maxOutputTokens: 64_000 })).toBe(170_000);
    expect(compactionReserveFor({ contextWindow: 1_000_000, maxOutputTokens: 200_000 })).toBe(150_000);
    // With a smaller output cap the cap wins: the summary is written inside
    // the reserve, and this model cannot write 150k in one reply.
    expect(compactionReserveFor({ contextWindow: 1_000_000, maxOutputTokens: 131_072 })).toBe(131_072);
  });

  it("keeps the 20k floor where 15% would be less", () => {
    expect(compactionReserveFor({ contextWindow: 128_000, maxOutputTokens: "unknown" })).toBe(20_000);
  });

  it("never reserves more than the model can write", () => {
    // The summary is written inside the reserve; a 200k model that writes
    // at most 8k gets an 8k reserve, as Flue's own default would.
    expect(compactionReserveFor({ contextWindow: 200_000, maxOutputTokens: 8_192 })).toBe(8_192);
  });

  it("reserves a third of a small window", () => {
    expect(compactionReserveFor({ contextWindow: 8_192, maxOutputTokens: 4_096 })).toBe(2_730);
    expect(compactionReserveFor({ contextWindow: 2_048, maxOutputTokens: "unknown" })).toBe(1024);
  });

  it("answers nothing for a model whose window is unknown", () => {
    expect(compactionReserveFor({ contextWindow: "unknown", maxOutputTokens: 8_192 })).toBeUndefined();
    expect(compactionThresholdFor({ contextWindow: "unknown", maxOutputTokens: 8_192 })).toBeUndefined();
  });
});

describe("compactionConfigFor", () => {
  it("hands the engine the prompts always, and the reserve when there is a window", () => {
    expect(compactionConfigFor({ contextWindow: 200_000, maxOutputTokens: 64_000 })).toEqual({
      prompts: COMPACTION_PROMPTS,
      reserveTokens: 30_000,
    });
    // No window: the overflow path still summarises, with Studio's prompts.
    expect(compactionConfigFor({ contextWindow: "unknown", maxOutputTokens: "unknown" })).toEqual({
      prompts: COMPACTION_PROMPTS,
    });
    expect(compactionConfigFor(undefined)).toEqual({ prompts: COMPACTION_PROMPTS });
  });
});

describe("the summariser prompts", () => {
  it("ask for the overview and the reminders, and say when to leave the ledger out", () => {
    expect(COMPACTION_PROMPTS.summary).toContain("## Overview");
    expect(COMPACTION_PROMPTS.summary).toContain("## Reminders");
    expect(COMPACTION_PROMPTS.summary).toMatch(/no files, no commands and no tasks/);
    expect(COMPACTION_PROMPTS.update).toContain("<previous-summary>");
    expect(COMPACTION_PROMPTS.update).toMatch(/Move items from "In Progress" to "Done"/);
    expect(COMPACTION_PROMPTS.reasoning).toBe("low");
  });
});
