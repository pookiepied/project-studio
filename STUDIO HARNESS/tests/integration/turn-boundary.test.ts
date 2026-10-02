import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { SnapshotStore } from "../../src/snapshots/store.js";
import { ProjectStore } from "../../src/projects/store.js";
import { conversationWorkspaceDirectory } from "../../src/platform/paths.js";
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

/**
 * Two runs of one conversation. Named because that is the whole premise: the
 * turn counter continues across the second initializer *because* the
 * conversation did not end. This used to be implicit — both calls passed
 * `agentId: "studio"` and the conversation id was derived from it — so the
 * test passed for a reason it never stated. Since #69 the caller says it,
 * and under Flue 2.0 the scope vocabulary is the bare conversation id.
 */
const SAME_CONVERSATION = {
  agentId: "studio",
  conversationId: "thread-1",
} as const;

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
          const env = await sandbox.createSandbox({ id: "studio" });
          const tools = sandbox.tools?.(env, { subagents: {} }) ?? [];
          const tool = tools.find((candidate) => candidate.name === "write");
          expect(tool).toBeDefined();
          await tool?.execute("call", { path: name, content: name });
        };

        // Run one.
        const first = runtime.createAgentSandbox(SAME_CONVERSATION);
        await runtime.prepareModelTurn();
        await write(first, "one.txt");

        // Run two: a second initializer for the same agent, exactly as Flue
        // does it. Nothing about the conversation has ended.
        const second = runtime.createAgentSandbox(SAME_CONVERSATION);
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

  /**
   * Two conversations, one project, one history.
   *
   * The undo history is a single shadow repository per workspace root —
   * `SnapshotStore` builds its `gitDir` from that root and nothing else — so
   * two conversations working in one project write into one log. Turn state
   * used to be keyed per conversation in front of it, and the mismatch showed
   * up three ways at once: two `ShadowRepository` objects with independent
   * serialization queues over one git index (#83), an idle conversation's
   * counter advancing on someone else's turn (#84), and two snapshots both
   * labelled "turn 1" in the same log with nothing to tell them apart (#85).
   *
   * The label is the observable, as above. Under the old key this produced
   * `["turn 1", "turn 1"]`; the numbers are now the project's, which is whose
   * history it is.
   */
  it(
    "keeps one turn history per project when two conversations share it",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "studio-turn-project-"));
      temporaryDirectories.push(directory);
      const projectRoot = join(directory, "project");
      await mkdir(projectRoot, { recursive: true });
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
          const env = await sandbox.createSandbox({ id: "studio" });
          const tools = sandbox.tools?.(env, { subagents: {} }) ?? [];
          const tool = tools.find((candidate) => candidate.name === "write");
          expect(tool).toBeDefined();
          await tool?.execute("call", { path: name, content: name });
        };

        const alpha = runtime.createAgentSandbox({
          agentId: "studio",
          conversationId: "alpha",
        });
        await runtime.prepareModelTurn();
        await write(alpha, "alpha.txt");

        // A different conversation in the same project. Nothing about the
        // workspace changed, so nothing about its history should restart.
        const beta = runtime.createAgentSandbox({
          agentId: "studio",
          conversationId: "beta",
        });
        await runtime.prepareModelTurn();
        await write(beta, "beta.txt");

        const history = await new SnapshotStore({ workspaceRoot: projectRoot }).list();
        expect(history.map((snapshot) => snapshot.label)).toEqual(["turn 2", "turn 1"]);
      } finally {
        await runtime.stop();
        database.close();
      }
    },
    60_000,
  );

  /**
   * The undo route's store is the gate's store.
   *
   * `snapshotStoreFor` exists so the undo history is reachable at all
   * (register #86), and its one non-negotiable property is that it resolves
   * to the same `SnapshotStore` instance the conversation's gate holds: the
   * shadow repository's lock is an in-process queue per instance (T-17), so
   * a second instance would run a restore *beside* the captures instead of
   * behind them. Instance identity is the observable, and a write through
   * the gate showing up in the route's history is its end-to-end proof.
   */
  it(
    "hands the undo route the same store the gate captures into",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "studio-undo-route-"));
      temporaryDirectories.push(directory);
      const projectRoot = join(directory, "project");
      await mkdir(projectRoot, { recursive: true });
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

        const fromRoute = runtime.snapshotStoreFor(SAME_CONVERSATION.conversationId);
        // The map is the whole mechanism: every ask resolves to the one
        // store, never a fresh one over the same git directory.
        expect(runtime.snapshotStoreFor(SAME_CONVERSATION.conversationId)).toBe(fromRoute);
        // An unfiled conversation's undo history is its own workspace
        // directory — the same root the agent hands the sandbox factory, and
        // the same one the run builder resolves to, which is the point: the
        // route must resolve the way the run does.
        expect(fromRoute.workspaceRoot).toBe(
          resolve(conversationWorkspaceDirectory(SAME_CONVERSATION.conversationId)),
        );

        // The workspace does not exist yet — nothing has run. Reading the
        // history through the route's store must answer empty, not fail to
        // spawn, because a conversation that exists but never ran is an
        // ordinary thing to open the history of.
        expect(await fromRoute.list()).toEqual([]);

        // Now the precondition a run creates (the sandbox factory
        // ensureDirectories the conversation's workspace), and the turn
        // writes for real — with the projectRoot the real agent passes,
        // because the factory called bare, as the tests above call it, falls
        // back to the runtime root and the run resolves somewhere else.
        await mkdir(conversationWorkspaceDirectory(SAME_CONVERSATION.conversationId), {
          recursive: true,
        });
        new WorkspaceTrustStore(database).set(
          resolve(conversationWorkspaceDirectory(SAME_CONVERSATION.conversationId)),
          true,
        );
        const sandbox = runtime.createAgentSandbox({
          ...SAME_CONVERSATION,
          projectRoot: conversationWorkspaceDirectory(SAME_CONVERSATION.conversationId),
        });
        await runtime.prepareModelTurn();
        const env = await sandbox.createSandbox({ id: "studio" });
        const tools = sandbox.tools?.(env, { subagents: {} }) ?? [];
        const tool = tools.find((candidate) => candidate.name === "write");
        await tool?.execute("call", { path: "undo.txt", content: "undo" });

        const history = await fromRoute.list();
        expect(history).toHaveLength(1);
      } finally {
        await runtime.stop();
        database.close();
      }
    },
    60_000,
  );

  /**
   * A filed conversation's undo history is the project's first folder's, not
   * its own workspace directory. The accessor resolves the project the way
   * `createAgentSandbox` does, because a restore that returned the wrong
   * tree would be worse than no restore at all: it would look like one.
   */
  it(
    "resolves a filed conversation's undo history to the project's first folder",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "studio-undo-filed-"));
      temporaryDirectories.push(directory);
      const projectRoot = join(directory, "project");
      await mkdir(projectRoot, { recursive: true });
      const projectFolder = join(directory, "repo");
      await mkdir(projectFolder, { recursive: true });
      previousHome = process.env.PROJECT_STUDIO_HOME;
      process.env.PROJECT_STUDIO_HOME = join(directory, "home");

      const database = openDatabase({ path: join(directory, "studio.db") });
      const runtime = new StudioRuntime({ database, projectRoot, credentials });

      try {
        const project = new ProjectStore(database).create({
          name: "repo",
          icon: "arc",
          folders: [{ name: "repo", path: projectFolder }],
        });
        new ConversationStore(database).record({
          id: "thread-filed",
          firstMessage: "filed",
          projectId: project.id,
        });

        const store = runtime.snapshotStoreFor("thread-filed");
        expect(store.workspaceRoot).toBe(resolve(projectFolder));
      } finally {
        await runtime.stop();
        database.close();
      }
    },
    60_000,
  );
});
