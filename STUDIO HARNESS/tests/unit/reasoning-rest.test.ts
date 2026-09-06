import { describe, expect, it } from "vitest";

import {
  restingReasoningLevel,
  runThinkingLevelForChoice,
  type ReasoningLevel,
} from "../../src/contracts/models.js";
import { studioThinkingLevel } from "../../src/agents/studio.js";

/**
 * Task 60: the dial that starts in the middle.
 *
 * The resting rule is medium when the model supports it, otherwise the
 * nearest supported level in REASONING_LEVELS order, preferring the lower one
 * on a tie. Absence ("default") was abandoned because six adapters answer
 * silence by disabling thinking with no escape hatch.
 */

describe("the resting reasoning level", () => {
  it("rests on medium for a model that has it", () => {
    const supported: readonly ReasoningLevel[] = ["minimal", "low", "medium", "high"];
    expect(restingReasoningLevel(supported)).toBe("medium");
  });

  it("rests on the nearest lower level for a model whose list omits medium", () => {
    // Medium missing and no level one step above: low is uniquely nearest.
    const supported: readonly ReasoningLevel[] = ["minimal", "low", "xhigh", "max"];
    expect(restingReasoningLevel(supported)).toBe("low");
  });

  it("prefers the lower level on a tie, named explicitly", () => {
    // The tie case: low is one step below medium, high is one step above.
    // Both distance 1, lower wins.
    const tie: readonly ReasoningLevel[] = ["low", "high"];
    expect(restingReasoningLevel(tie)).toBe("low");
  });

  it("rests on the nearer exotic level rather than on an assumed midpoint", () => {
    // A model exposing only xhigh and max: xhigh is nearer medium (distance 2
    // vs 3), so it rests there. A list-midpoint rule would have rested such a
    // model at high, quietly more expensive.
    const exotic: readonly ReasoningLevel[] = ["xhigh", "max"];
    expect(restingReasoningLevel(exotic)).toBe("xhigh");
  });

  it("answers off only for a model that does not reason", () => {
    expect(restingReasoningLevel([])).toBe("off");
  });
});

describe("the resolver from a stored choice to the run", () => {
  it("resolves a stored default to the resting level rather than to off", () => {
    const supported: readonly ReasoningLevel[] = ["minimal", "low", "medium", "high"];
    expect(runThinkingLevelForChoice("default", supported)).toBe("medium");
    expect(runThinkingLevelForChoice(null, supported)).toBe("medium");
    expect(runThinkingLevelForChoice(undefined, supported)).toBe("medium");
  });

  it("carries an explicit level verbatim", () => {
    const supported: readonly ReasoningLevel[] = ["minimal", "low", "medium", "high"];
    expect(runThinkingLevelForChoice("high", supported)).toBe("high");
  });

  it("stays silent only for a non-reasoning model", () => {
    expect(runThinkingLevelForChoice("default", [])).toBe("off");
    expect(runThinkingLevelForChoice("high", [])).toBe("off");
    expect(runThinkingLevelForChoice(null, [])).toBe("off");
  });
});

describe("the studio render's thinking level", () => {
  it("resolves a stored default row to the resting level", () => {
    const supported: readonly ReasoningLevel[] = ["minimal", "low", "medium", "high"];
    expect(
      studioThinkingLevel({ modelId: "openrouter/anthropic/claude-sonnet-4.5", reasoningLevel: "default" }, supported),
    ).toBe("medium");
    expect(studioThinkingLevel({ modelId: null, reasoningLevel: null }, supported)).toBe("medium");
  });

  it("keeps a non-reasoning model silent", () => {
    expect(studioThinkingLevel({ modelId: "ollama/llama3", reasoningLevel: "default" }, [])).toBe("off");
    expect(studioThinkingLevel({ modelId: "ollama/llama3", reasoningLevel: null }, [])).toBe("off");
  });
});
