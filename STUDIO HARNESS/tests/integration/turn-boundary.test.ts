import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { SnapshotStore } from "../../src/snapshots/store.js";
import { openDatabase } from "../../src/storage/database.js";

/**
 * Turn state has to survive Flue re-initializing the agent.
 *
 * Flue runs an agent's initializer "whenever a runner initializes a root
 * harness" — its own words — so `createAgentSandbox` is called once per *run*,
 * not once per process. It used to build a fresh `TurnSnapshots` each time and
 * append it to an unkeyed set, which meant the turn counter restarted at zero
 * every run and `prepareModelTurn` fanned out to every sandbox ever built.
 *
 * The label is the observable. `TurnSnapshots` passes it straight to
 * `SnapshotStore.capture`, so the shadow repository's own log is the proof —
 * and it is the same thing a person reads when choosing what to undo.
 */

const credentials: SecureCredentialStore = {
  get: async () => null,
  set: async () => undefined,
  delete: async () => false,
};

const temporaryDirectories: string[] = [];
let previousHome: string | undefined;

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  previousHome = undefined;

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

describe("the model-turn boundary", () => {
  it(
    "keeps one turn history per conversation across agent re-initialization",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "studio-turn-boundary-"));
      temporaryDirectories.push(directory);
      const projectRoot = join(directory, "project");
      await mkdir(projectRoot, { recursive: true });
      // Redirects the shadow repositories, so this test's history is not
      // written into the developer's real snapshot directory.
      previousHome = process.env.PROJECT_STUDIO_HOME;
      process.env.PROJECT_STUDIO_HOME = join(directory, "home");

      const database = openDatabase({ path: join(directory, "studio.db") });
      const runtime = new StudioRuntime({
        database,
        projectRoot,
        credentials,
        approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
      });

      try {
        new WorkspaceTrustStore(database).set(projectRoot, true);

        const write = async (
          sandbox: ReturnType<StudioRuntime["createAgentSandbox"]>,
          name: string,
        ): Promise<void> => {
          const env = await sandbox.createSessionEnv({ id: "studio" });
          const tools = sandbox.tools?.(env, { subagents: {} }) ?? [];
          const tool = tools.find((candidate) => candidate.name === "write");
          expect(tool).toBeDefined();
          await tool?.execute("call", { path: name, content: name });
        };

        // Run one.
        const first = runtime.createAgentSandbox({ agentId: "studio" });
        await runtime.prepareModelTurn();
        await write(first, "one.txt");

        // Run two: a second initializer for the same agent, exactly as Flue
        // does it. Nothing about the conversation has ended.
        const second = runtime.createAgentSandbox({ agentId: "studio" });
        await runtime.prepareModelTurn();
        await write(second, "two.txt");

        const history = await new SnapshotStore({ workspaceRoot: projectRoot }).list();
        const labels = history.map((snapshot) => snapshot.label);

        // Two turns, numbered consecutively. Before this fix the second run
        // started a fresh counter and both snapshots were labelled "turn 1".
        expect(labels).toEqual(["turn 2", "turn 1"]);
      } finally {
        await runtime.stop();
        database.close();
      }
    },
    60_000,
  );
});
