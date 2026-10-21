import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { FlueObservation } from "@flue/runtime";

import { TaskStore } from "../../src/agents/definitions/task-store.js";
import { StudioRuntime } from "../../src/application/studio-runtime.js";
import { IMPROVE_AGENT_ID, TITLE_AGENT_ID } from "../../src/contracts/agents.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { openDatabase } from "../../src/storage/database.js";
import { diagnosticRecorder } from "../../src/observability/recorder.js";

/**
 * A background task's settlement, end to end within this runtime (ADR 0058
 * D5, S4.2): a task the harness dispatched becomes a row; the row settles
 * when the stream settles; the conversation the dispatch named hears of it
 * through the JobPings hub - without anybody sending a message, which is the
 * whole point - and the environment block names the task while it runs and
 * says nothing once it has ended.
 *
 * The dispatch's first half (the row recorded at dispatch time) and the
 * projector's subscription are real; what is injected is the runtime's
 * observation subscription and Flue's delivery, exactly as the
 * finished-job-pings suite injects the last hop of a generation's ending.
 * The dispatch half against a live Flue runtime is `tests/integration/tasks.test.ts`.
 */

interface Harness {
  readonly runtime: StudioRuntime;
  readonly tasks: TaskStore;
  /** Everything the deliver port received, oldest first. */
  readonly deliveries: { conversationId: string; body: string }[];
  /** Drives the projector's observations, in order, the way the bus would. */
  readonly emit: (observation: FlueObservation) => void;
  readonly cleanup: () => Promise<void>;
}

function agentEnd(instanceId: string, text: string): FlueObservation {
  return {
    type: "agent_end",
    instanceId,
    agentName: TITLE_AGENT_ID,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "project-studio-test",
        provider: "project-studio-test",
        model: "default",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    ],
  } as unknown as FlueObservation;
}

function settled(instanceId: string, outcome: "completed" | "failed" | "aborted"): FlueObservation {
  return {
    type: "submission_settled",
    instanceId,
    agentName: TITLE_AGENT_ID,
    submissionId: "sub_1",
    outcome,
  } as unknown as FlueObservation;
}

async function harnessWith(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "studio-task-settle-"));
  const previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(directory, "home");
  const database = openDatabase({ path: join(directory, "studio.db") });
  const deliveries: { conversationId: string; body: string }[] = [];
  const queue: ((observation: FlueObservation) => void)[] = [];
  const runtime = new StudioRuntime({
    database,
    deliverJobPing: async (conversationId, body) => {
      deliveries.push({ conversationId, body });
    },
    subscribeTaskSettlements: (handler) => {
      queue.push(handler);
      return () => undefined;
    },
  });
  // The row the announcement's guard reads.
  new ConversationStore(database).record({
    id: "cnv_task",
    firstMessage: "First",
    permissionMode: "auto",
  });
  return {
    runtime,
    tasks: runtime.tasks,
    deliveries,
    emit: (observation) => {
      for (const handler of queue) handler(observation);
    },
    cleanup: async () => {
      process.env.PROJECT_STUDIO_HOME = previousHome;
      await runtime.stop();
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("a background task's settlement", () => {
  it(
    "reaches the conversation's deliver port exactly once, and the block stops naming it",
    async () => {
      const harness = await harnessWith();
      try {
        // Dispatched: the row exists, running, and the turn's environment
        // block names it - current state, a read rather than a drain.
        harness.tasks.record({
          id: "cnv_task-t1",
          agentName: TITLE_AGENT_ID,
          parentConversationId: "cnv_task",
        });
        expect(harness.runtime.conversationBackgroundTasks("cnv_task")).toEqual([
          'Task "Titler" is running in the background.',
        ]);
        expect(harness.deliveries).toEqual([]);

        // The run ends: the capture rides agent_end, the settlement maps to
        // the row, and the announce reaches the conversation's deliver port.
        harness.emit(agentEnd("cnv_task-t1", "Sandbox factory notes"));
        harness.emit(settled("cnv_task-t1", "completed"));
        for (let attempt = 0; attempt < 200 && harness.deliveries.length === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(harness.deliveries).toHaveLength(1);
        expect(harness.deliveries[0]?.conversationId).toBe("cnv_task");
        expect(harness.deliveries[0]?.body).toContain("Background work has finished:");
        expect(harness.deliveries[0]?.body).toContain(
          'Task "Titler" completed: Sandbox factory notes',
        );
        expect(harness.deliveries[0]?.body).toContain("This message is the harness, not the user");

        // The row settled with the pointer-shape summary.
        const row = harness.tasks.get("cnv_task-t1");
        expect(row?.status).toBe("completed");
        expect(row?.resultSummary).toBe("Sandbox factory notes");

        // And the block stops naming it: the ending was news once, delivered
        // above; naming it again on every later turn would be the noise the
        // three-delivery-points discipline exists to prevent.
        expect(harness.runtime.conversationBackgroundTasks("cnv_task")).toEqual([]);

        // A replayed settlement (recovery's at-least-once) changes nothing
        // and delivers nothing: the row is terminal and the news was told.
        harness.emit(settled("cnv_task-t1", "completed"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(harness.deliveries).toHaveLength(1);
        expect(harness.tasks.get("cnv_task-t1")?.status).toBe("completed");
      } finally {
        await harness.cleanup();
      }
    },
    30_000,
  );

  it(
    "settles a cancelled task and tells the conversation it was stopped",
    async () => {
      const harness = await harnessWith();
      try {
        harness.tasks.record({
          id: "cnv_task-task-1",
          agentName: IMPROVE_AGENT_ID,
          parentConversationId: "cnv_task",
          title: "Summarize the folder",
        });

        // The cancel route records the abort intent; the stream settles
        // aborted; the row reads cancelled and the news says so.
        harness.emit(settled("cnv_task-task-1", "aborted"));
        expect(harness.tasks.get("cnv_task-task-1")?.status).toBe("cancelled");

        for (let attempt = 0; attempt < 200 && harness.deliveries.length === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(harness.deliveries).toHaveLength(1);
        expect(harness.deliveries[0]?.body).toContain(
          'Task "Summarize the folder" was stopped.',
        );
      } finally {
        await harness.cleanup();
      }
    },
    30_000,
  );

  it(
    "tells the voice conversation a worker's result in the same tick it settles, and its parent can inspect the steps",
    async () => {
      const harness = await harnessWith();
      diagnosticRecorder.configure({ enabled: true, captureContent: false, conversations: [] });
      try {
        harness.tasks.record({ id: "voice_1", agentName: "voice-work", parentConversationId: "cnv_task", originSubmissionId: "sub_1", title: "Hazel" });
        harness.emit({ type: "agent_start", instanceId: "voice_1" } as unknown as FlueObservation);
        harness.emit({ type: "tool_start", instanceId: "voice_1", toolCallId: "c", toolName: "read", args: { path: "PRIVATE_PATH" } } as unknown as FlueObservation);
        const view = await harness.runtime.inspectTask("cnv_task", "voice_1", {});
        expect(view.entries.map((entry) => entry.kind)).toEqual(["started", "tool_call"]);
        expect((await harness.runtime.inspectTask("cnv_other", "voice_1", {})).available).toBe(false);
        const reads = diagnosticRecorder.read().events.filter((event) => event.name.startsWith("task.inspect"));
        expect(reads.some((event) => event.name === "task.inspect.read" && event.attributes.entries === 2)).toBe(true);
        expect(JSON.stringify(reads)).not.toContain("PRIVATE_PATH");

        // The announcement is not batched or polled: the deliver port has
        // the result before anything else gets to run.
        harness.emit(agentEnd("voice_1", "It is twelve degrees and clear."));
        harness.emit(settled("voice_1", "completed"));
        expect(harness.deliveries).toHaveLength(1);
        expect(harness.deliveries[0]?.body).toContain("It is twelve degrees and clear.");
      } finally {
        diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
        await harness.cleanup();
      }
    },
    30_000,
  );

  it(
    "says nothing to a conversation when the dispatch named no parent",
    async () => {
      const harness = await harnessWith();
      try {
        // The background three: their results reach their callers directly,
        // so their rows carry no parent conversation - and no announcement
        // can wake one that was never named.
        harness.tasks.record({ id: "dsc_1", agentName: "describe" });
        harness.emit(agentEnd("dsc_1", "A lighthouse at dusk."));
        harness.emit(settled("dsc_1", "completed"));

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(harness.deliveries).toEqual([]);
        expect(harness.tasks.get("dsc_1")?.status).toBe("completed");
      } finally {
        await harness.cleanup();
      }
    },
    30_000,
  );
});
