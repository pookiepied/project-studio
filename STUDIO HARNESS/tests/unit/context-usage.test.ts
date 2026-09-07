import { describe, expect, it } from "vitest";

import { ContextUsageTracker } from "../../src/conversations/context-usage.js";
import type { FlueObservation } from "@flue/runtime";

/**
 * The number that says how full a conversation's window is.
 *
 * It was being estimated in the webview from the characters it had rendered,
 * which is not the request that was sent: no system prompt, no tool
 * definitions, no tool inputs or results, no images. On an agentic turn the
 * tool traffic is most of the prompt, so the estimate missed most of what it
 * was measuring - about half, measured against a provider's own figure.
 *
 * The provider does report it. It reaches the harness on the observation
 * stream and nowhere else: Flue 2.0 stamps no usage into message metadata,
 * and its `message-completed` chunk carries none either. So what is pinned
 * here is that this reads the right event, files it under the right id, and
 * keeps the right one of several.
 */

function turn(
  instanceId: string,
  usage: Record<string, number> | undefined,
  agentName = "studio",
): FlueObservation {
  return {
    type: "turn",
    turnId: "t1",
    purpose: "agent",
    durationMs: 10,
    request: { providerId: "p", providerName: "P", requestedModel: "m", api: "a" },
    response: usage === undefined ? {} : { usage },
    isError: false,
    instanceId,
    agentName,
  } as unknown as FlueObservation;
}

/** A tracker with the live subscription replaced by nothing. */
function tracker(): ContextUsageTracker {
  return new ContextUsageTracker({ subscribe: () => () => {} });
}

describe("the measured context", () => {
  it("records what the provider said the prompt was", () => {
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 1_000, cacheRead: 90_000, cacheWrite: 500, output: 300 }));

    expect(usage.get("cnv_1")).toMatchObject({
      input: 1_000,
      cacheRead: 90_000,
      cacheWrite: 500,
      output: 300,
    });
  });

  it("keeps the latest turn rather than adding them up", () => {
    // Every request of a submission resends the whole conversation, so their
    // usages are not parts of one prompt - each is a whole one. Summing them
    // answers what the conversation cost, which is a different question and
    // would read as a window several times past full.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 40_000, output: 100 }));
    usage.record(turn("cnv_1", { input: 52_000, output: 200 }));

    expect(usage.get("cnv_1")?.input).toBe(52_000);
  });

  it("ignores a turn run by another agent on the same conversation", () => {
    // The titler dispatches its own runs under a conversation-derived id. Its
    // prompt is eight words. Counting it would collapse the measurement of a
    // hundred-thousand-token conversation every time it got renamed.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 90_000, output: 300 }));
    usage.record(turn("cnv_1", { input: 120, output: 8 }, "title"));

    expect(usage.get("cnv_1")?.input).toBe(90_000);
  });

  it("does not overwrite a measurement with a turn that measured nothing", () => {
    // A turn reporting no usage is one nobody measured. Storing zeroes for it
    // would claim the window had emptied.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 90_000, output: 300 }));
    usage.record(turn("cnv_1", undefined));

    expect(usage.get("cnv_1")?.input).toBe(90_000);
  });

  it("treats an all-zero report as no measurement, not as an empty window", () => {
    // A usage object that is present and all zeroes says the same thing as no
    // usage object at all: nobody counted. Written separately from the case
    // above because they take different paths through the reader, and the
    // first one alone leaves this line untested.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 90_000, output: 300 }));
    usage.record(turn("cnv_1", { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }));

    expect(usage.get("cnv_1")?.input).toBe(90_000);
  });

  it("keeps one conversation's measurement out of another's", () => {
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 90_000, output: 300 }));

    expect(usage.get("cnv_2")).toBeUndefined();
  });

  it("answers nothing for a conversation no turn has reported on", () => {
    // The ordinary state before a first reply lands, and after a restart.
    // The caller falls back to its estimate, which is not an error path.
    expect(tracker().get("cnv_never")).toBeUndefined();
  });
})
