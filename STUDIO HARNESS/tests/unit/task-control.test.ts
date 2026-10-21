import { afterEach, describe, expect, it, vi } from "vitest";
import { steerTask, taskActivitySurface } from "../../src/agents/task-control.js";
import { VOICE_PROMPT } from "../../src/context/voice-prompt.js";
import type { AgentTaskRecord } from "../../src/agents/definitions/task-store.js";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(async (_agent: unknown, _request: unknown) => ({ submissionId: "correction", deduplicated: false })) }));
vi.mock("@flue/runtime", async (original) => ({ ...await original<typeof import("@flue/runtime")>(), dispatch: fixture.dispatch }));
afterEach(() => fixture.dispatch.mockClear());

const task: AgentTaskRecord = { id: "worker", agentName: "voice-work", parentConversationId: "parent", originSubmissionId: "host", title: "Drawing", status: "running", createdAt: 1, settledAt: undefined, resultSummary: undefined };

describe("task_activity routing by role", () => {
  it("offers the voice agent and a worker reading only, so a voice correction can only go through voice_work", () => {
    // The live failure: the voice model called task_activity steer because
    // the schema offered it, and the role refused it afterwards.
    for (const role of ["voice", "worker"] as const) {
      expect(taskActivitySurface(role).actions).toEqual(["status", "inspect"]);
    }
    expect(taskActivitySurface("voice").description).toMatch(/steer or cancel a voice task with voice_work/);
    expect(taskActivitySurface("conversation").actions).toEqual(["status", "inspect", "steer", "cancel"]);
  });

  it("tells the voice agent which tool steers and which only reads", () => {
    expect(VOICE_PROMPT).toMatch(/voice_work action steer/);
    expect(VOICE_PROMPT).toMatch(/voice_work action\s+cancel/);
    expect(VOICE_PROMPT).toMatch(/task_activity is read-only/);
    expect(VOICE_PROMPT).toMatch(/Never steer or cancel through task_activity/);
  });
});

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
