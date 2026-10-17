import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = vi.hoisted(() => ({
  starts: [] as Array<(context: { append: (message: unknown) => void }) => unknown>,
  jobs: [] as string[],
  tasks: [] as string[],
  readJobs: vi.fn(),
}));

vi.mock("@flue/runtime", async (original) => ({
  ...await original<typeof import("@flue/runtime")>(),
  useModel: vi.fn(),
  useSandbox: vi.fn(),
  useSkill: vi.fn(),
  useSubagent: vi.fn(),
  useDelivery: () => ({ kind: "user", body: "Build the new Next.js project." }),
  useAgentStart: (hook: (context: { append: (message: unknown) => void }) => unknown) => {
    fixture.starts.push(hook);
  },
}));

vi.mock("../../src/application/studio-runtime.js", () => ({
  getStudioRuntime: () => ({
    conversationTurnSettings: () => ({ modelId: null, reasoningLevel: null }),
    supportedReasoningLevels: () => [],
    createAgentSandbox: () => ({}),
    conversationBackgroundJobs: () => { fixture.readJobs(); return fixture.jobs; },
    conversationBackgroundTasks: () => fixture.tasks,
  }),
}));

import { Studio } from "../../src/agents/studio.js";

beforeEach(() => vi.stubEnv("PROJECT_STUDIO_HOME", join(tmpdir(), "studio-context-fixture")));

afterEach(() => {
  fixture.starts.length = 0;
  fixture.jobs = [];
  fixture.tasks = [];
  fixture.readJobs.mockClear();
  vi.unstubAllEnvs();
});

describe("live work is context, not a change to Studio's instructions", () => {
  it("keeps instructions identical when background jobs and delegates change", () => {
    const before = Studio({ id: "cnv_continuity_fixture" });
    fixture.jobs = ["job_fixture is running: npm run dev"];
    fixture.tasks = ["task_fixture is reviewing the page"];
    const running = Studio({ id: "cnv_continuity_fixture" });
    fixture.jobs = ["job_fixture was stopped"];
    fixture.tasks = [];
    const ended = Studio({ id: "cnv_continuity_fixture" });
    expect(running).toBe(before);
    expect(ended).toBe(before);
    // Rendering must not drain an ending before an admitted start can deliver it.
    expect(fixture.readJobs).not.toHaveBeenCalled();
  });

  it("delivers current work at admission without replacing the user's task", async () => {
    fixture.jobs = ["job_fixture is running: npm run dev"];
    Studio({ id: "cnv_continuity_fixture" });
    const messages: unknown[] = [];
    for (const hook of fixture.starts) await hook({ append: (message) => messages.push(message) });
    expect(messages).toContainEqual(expect.objectContaining({
      kind: "signal",
      type: "background_work",
      body: expect.stringContaining("job_fixture is running"),
    }));
    expect(fixture.readJobs).toHaveBeenCalledTimes(1);
  });
});
