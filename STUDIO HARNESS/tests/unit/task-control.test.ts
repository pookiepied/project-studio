import { afterEach, describe, expect, it, vi } from "vitest";
import { steerTask } from "../../src/agents/task-control.js";
import type { AgentTaskRecord } from "../../src/agents/definitions/task-store.js";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(async (_agent: unknown, _request: unknown) => ({ submissionId: "correction", deduplicated: false })) }));
vi.mock("@flue/runtime", async (original) => ({ ...await original<typeof import("@flue/runtime")>(), dispatch: fixture.dispatch }));
afterEach(() => fixture.dispatch.mockClear());

const task: AgentTaskRecord = { id: "worker", agentName: "voice-work", parentConversationId: "parent", originSubmissionId: "host", title: "Drawing", status: "running", createdAt: 1, settledAt: undefined, resultSummary: undefined };

describe("task steering", () => {
  it("keeps the existing worker and exact correction, with a separate deduplication key", async () => {
    expect(await steerTask(task, "Not a circle. Draw a square.", "admission-key")).toBe("correction");
    expect(fixture.dispatch).toHaveBeenCalledOnce();
    expect(fixture.dispatch.mock.calls[0]?.[1]).toEqual({ id: "worker", message: { kind: "user", body: "Not a circle. Draw a square.", deliveryMode: "steer" }, idempotencyKey: "admission-key" });
  });

  it("refuses settled tasks and unbounded corrections before admission", async () => {
    await expect(steerTask({ ...task, status: "completed" }, "Again")).rejects.toThrow(/finished/);
    await expect(steerTask(task, " ")).rejects.toThrow(/characters/);
    await expect(steerTask(task, "x".repeat(16_001))).rejects.toThrow(/characters/);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
});
