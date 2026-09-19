import { afterEach, describe, expect, it } from "vitest";

import { ContextUsageTracker } from "../../src/conversations/context-usage.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
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
  purpose = "agent",
): FlueObservation {
  return {
    type: "turn",
    turnId: "t1",
    purpose,
    durationMs: 10,
    request: { providerId: "p", providerName: "P", requestedModel: "m", api: "a" },
    response: usage === undefined ? {} : { usage },
    isError: false,
    instanceId,
    agentName,
  } as unknown as FlueObservation;
}

function compaction(
  instanceId: string,
  usage: Record<string, number> | undefined,
  isError = false,
): FlueObservation {
  return {
    type: "compaction",
    messagesBefore: 80,
    messagesAfter: 6,
    durationMs: 4_000,
    isError,
    ...(usage === undefined ? {} : { usage }),
    instanceId,
    agentName: "studio",
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

  it("ignores the summariser's own requests", () => {
    // A compaction's model calls carry the whole transcript as their prompt
    // and arrive as turns with their own purpose. Counted, the last figure
    // for a conversation that was just emptied would be its largest ever.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 90_000, output: 300 }));
    usage.record(turn("cnv_1", { input: 150_000, output: 6_000 }, "studio", "compaction"));

    expect(usage.get("cnv_1")?.input).toBe(90_000);
  });

  it("writes a provisional figure after a compaction, marked as an estimate", () => {
    // The window was just emptied and nothing has measured it. Left alone
    // the meter would say "full" about a conversation that is not; the row
    // written here is the summary, the kept tail and a fixed allowance, and
    // it says it is an estimate so the meter can too.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 170_000, output: 300 }));
    usage.record(compaction("cnv_1", { input: 150_000, output: 6_000 }));

    const after = usage.get("cnv_1");
    expect(after?.estimated).toBe(true);
    expect(after?.input).toBe(6_000 + 8_000 + 12_000);
    expect(after?.cacheRead).toBe(0);

    // The next measured turn is the truth again.
    usage.record(turn("cnv_1", { input: 30_000, output: 400 }));
    expect(usage.get("cnv_1")).toMatchObject({ input: 30_000, estimated: false });
  });

  it("leaves the figure alone when a compaction failed or was cancelled", () => {
    // Nothing was written to the conversation, so the window is as it was.
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 170_000, output: 300 }));
    usage.record(compaction("cnv_1", undefined, true));

    expect(usage.get("cnv_1")).toMatchObject({ input: 170_000, estimated: false });
  });

  it("keeps one conversation's measurement out of another's", () => {
    const usage = tracker();
    usage.record(turn("cnv_1", { input: 90_000, output: 300 }));

    expect(usage.get("cnv_2")).toBeUndefined();
  });

  it("answers nothing for a conversation no turn has reported on", () => {
    // The ordinary state before a first reply lands. The caller falls back
    // to its estimate, which is not an error path.
    expect(tracker().get("cnv_never")).toBeUndefined();
  });
});

/**
 * The figure across a restart.
 *
 * The tracker was memory only, and the harness is restarted far more often
 * than a transcript changes: every rebuild, every quit. Each restart sent
 * every conversation back to the webview's estimate - about a fifth of the
 * real number - until its next turn, and the meter was reported broken three
 * times for it. A second tracker on the same database stands in for the
 * process that comes back.
 */
describe("the measured context across a restart", () => {
  const opened: StudioDatabase[] = [];
  const database = (): StudioDatabase => {
    const db = openDatabase({ path: ":memory:" });
    opened.push(db);
    return db;
  };
  afterEach(() => {
    for (const db of opened.splice(0)) db.close();
  });

  it("answers after a restart with what the last process measured", () => {
    const db = database();
    const before = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    before.record(turn("cnv_1", { input: 1_000, cacheRead: 90_000, cacheWrite: 500, output: 300 }));

    const after = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    expect(after.get("cnv_1")).toMatchObject({
      input: 1_000,
      cacheRead: 90_000,
      cacheWrite: 500,
      output: 300,
    });
  });

  it("keeps the latest turn in the store, not the first", () => {
    const db = database();
    const before = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    before.record(turn("cnv_1", { input: 40_000, output: 100 }));
    before.record(turn("cnv_1", { input: 52_000, output: 200 }));

    const after = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    expect(after.get("cnv_1")?.input).toBe(52_000);
  });

  it("keeps the estimate mark across a restart", () => {
    const db = database();
    const before = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    before.record(turn("cnv_1", { input: 170_000, output: 100 }));
    before.record(compaction("cnv_1", { output: 5_000 }));

    const after = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    expect(after.get("cnv_1")).toMatchObject({ input: 25_000, estimated: true });
  });

  it("forgets from the store as well as from memory", () => {
    const db = database();
    const before = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    before.record(turn("cnv_1", { input: 40_000, output: 100 }));
    before.forget("cnv_1");

    const after = new ContextUsageTracker({ subscribe: () => () => {}, database: db });
    expect(after.get("cnv_1")).toBeUndefined();
  });
});
