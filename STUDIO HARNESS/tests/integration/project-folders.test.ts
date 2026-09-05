import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { ProjectStore } from "../../src/projects/store.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * A command run in a project conversation can write the project's second
 * folder - against real containment, not against the policy object.
 *
 * The whole task in one command: a conversation filed under a project stands
 * in the project's first folder, the person's other folders ride the policy
 * as write roots, and a contained child process - the kind of thing a model
 * actually starts - can write into the second one. Without the roots, the
 * same command is refused. This is `sandbox-scope.test.ts`'s shape, taken one
 * level up: through the project conversation's own tool surface, gate,
 * kernel, and sandbox, with Full Auto resolving the ask the way a run does.
 *
 * Every directory here is one the test created and removes afterwards.
 */

const credentials: SecureCredentialStore = {
  get: async () => null,
  set: async () => undefined,
  delete: async () => false,
};

interface Harness {
  readonly runtime: StudioRuntime;
  readonly database: StudioDatabase;
  readonly projects: ProjectStore;
  readonly conversations: ConversationStore;
  readonly root: string;
}

let previousHome: string | undefined;
let current: Harness | undefined;

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  previousHome = undefined;

  if (current !== undefined) {
    await current.runtime.stop();
    current.database.close();
    rmSync(current.root, { recursive: true, force: true });
    current = undefined;
  }
});

async function harness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "studio-project-folders-"));
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(root, "home");

  const database = openDatabase({ path: join(root, "studio.db") });
  const runtime = new StudioRuntime({ database, credentials });
  current = {
    runtime,
    database,
    projects: new ProjectStore(database),
    conversations: new ConversationStore(database),
    root,
  };
  return current;
}

interface SandboxTool {
  readonly name: string;
  execute(toolCallId: string, input: unknown): Promise<unknown>;
}

async function shellOf(harnessState: Harness, conversationId: string, projectRoot: string) {
  const factory = harnessState.runtime.createAgentSandbox({
    agentId: "studio",
    conversationId,
    projectRoot,
  });
  const env = await factory.createSandbox({ id: conversationId });
  const tools: readonly SandboxTool[] = factory.tools?.(env, { subagents: {} }) ?? [];
  const shell = tools.find((candidate) => candidate.name === "shell");
  if (shell === undefined) throw new Error('The sandbox did not offer a "shell" tool.');
  return shell;
}

describe("a project conversation under real containment", () => {
  it(
    "runs a command that writes the project's second folder",
    async () => {
      if (process.platform !== "win32") return;
      const state = await harness();
      const first = join(state.root, "repo");
      const second = join(state.root, "assets");
      const outside = join(state.root, "elsewhere");
      mkdirSync(first, { recursive: true });
      mkdirSync(second, { recursive: true });
      mkdirSync(outside, { recursive: true });

      const project = state.projects.create({
        id: "prj_build",
        name: "Build",
        icon: "arc",
        folders: [
          { name: "repo", path: first },
          { name: "assets", path: second },
        ],
      });
      state.conversations.record({
        id: "cnv_build",
        firstMessage: "Build it",
        projectId: project.id,
        permissionMode: "full-auto",
      });
      // Opening a project is trusting its folder - the same decision the
      // conversation-mode harness records for its project root. The kernel
      // asks the trust of the sandbox root, which for this conversation is
      // the project's first folder.
      new WorkspaceTrustStore(state.database).set(first, true);

      const shell = await shellOf(state, "cnv_build", first);
      // The path rides as an argument, not inside the -e string, so the line
      // reads the same under either Windows interpreter.
      const target = join(second, "planted.txt");
      const line =
        `node -e "require('fs').writeFileSync(process.argv[1], 'planted')" "${target}"`;
      await shell.execute("call-1", { command: line });
      expect(existsSync(target)).toBe(true);

      // And the boundary still holds one step beyond the folders: the same
      // kind of command cannot write a directory that is nobody's root here.
      const denied = join(outside, "planted.txt");
      const deniedLine =
        `node -e "require('fs').writeFileSync(process.argv[1], 'planted')" "${denied}"`;
      await shell.execute("call-2", { command: deniedLine });
      expect(existsSync(denied)).toBe(false);
    },
    120_000,
  );
});
