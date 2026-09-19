import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CAN_CONTAIN } from "../helpers/contained.js";
import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { ProjectStore } from "../../src/projects/store.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationWorkspaceDirectory,
} from "../../src/platform/paths.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * A command run in a project conversation can write the project's second
 * folder - through the real tool surface, not against the policy object.
 *
 * The whole task in one command: a conversation filed under a project stands
 * in the project's first folder, the person's other folders ride the policy
 * as write roots, and a child process - the kind of thing a model actually
 * starts - can write into the second one. This is `sandbox-scope.test.ts`'s
 * shape, taken one level up: through the project conversation's own tool
 * surface, gate, kernel, and sandbox, with Auto resolving the ask the
 * way a run does.
 *
 * The second half - the same command refused a directory that is nobody's
 * root - is a fact about the container, and runs only where one exists. On
 * Windows there is none since ADR 0057: an approved command runs as the
 * person, and the gate's refusal of a write outside the roots is asserted on
 * the sandbox's own file operations in the unit suite instead.
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

describe("a project conversation and its folders", () => {
  it(
    "runs a command that writes the project's second folder",
    async () => {
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
        permissionMode: "auto",
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

      // And, where a container exists, the boundary still holds one step
      // beyond the folders: the same kind of command cannot write a directory
      // that is nobody's root here.
      if (!CAN_CONTAIN) return;
      const denied = join(outside, "planted.txt");
      const deniedLine =
        `node -e "require('fs').writeFileSync(process.argv[1], 'planted')" "${denied}"`;
      await shell.execute("call-2", { command: deniedLine });
      expect(existsSync(denied)).toBe(false);
    },
    120_000,
  );

  it(
    "reads what the harness copied beside the conversation, where the workspace's own roots do not reach",
    async () => {
      // The folders the model was never granted: an uploaded picture lived
      // only in Flue's attachment store, and a generation's output only
      // behind its artifacts route, so neither could be read, and `studio_image`
      // had no path to be handed. What changed is the read roots; this runs
      // the harness's own copy, then asks the sandbox for the bytes, the way
      // the read tool and the image tool both resolve.
      const state = await harness();
      state.conversations.record({
        id: "cnv_pics",
        firstMessage: "Reimagine this one",
        permissionMode: "auto",
      });

      // What the render does when a delivery carries pictures - before the
      // factory that grants the folder has ever run. The copy makes the
      // attachments directory itself; the factory's own creation of it then
      // finds it there.
      state.runtime.persistDeliveredAttachments("cnv_pics", [
        {
          data: Buffer.from([0x89, 0x50, 0x0d, 0x0a]).toString("base64"),
          mimeType: "image/png",
          filename: "photo.png",
        },
      ]);

      const factory = state.runtime.createAgentSandbox({
        agentId: "studio",
        conversationId: "cnv_pics",
        // No project: the conversation stands in its own workspace, and the
        // two folders that must be readable are its siblings. No trust, so
        // this is the contained case - the roots are the only way in.
        projectRoot: conversationWorkspaceDirectory("cnv_pics"),
      });
      const env = await factory.createSandbox({ id: "cnv_pics" });

      // What a finished generation does, mid-conversation: the app's own
      // bytes, filed, after admission had created the tree.
      const generated = join(conversationArtifactsDirectory("cnv_pics"), "cover.png");
      writeFileSync(generated, Buffer.from([1, 2, 3]));

      const copied = join(conversationAttachmentsDirectory("cnv_pics"), "photo.png");
      expect([...(await env.readFileBuffer(copied))]).toEqual([0x89, 0x50, 0x0d, 0x0a]);
      expect([...(await env.readFileBuffer(generated))]).toEqual([1, 2, 3]);

      // And the boundary holds one step beyond: a stranger folder of the
      // test's own is still nobody's root here.
      const stranger = join(state.root, "elsewhere.png");
      writeFileSync(stranger, Buffer.from([9]));
      await expect(env.readFileBuffer(stranger)).rejects.toThrow();
    },
    60_000,
  );
});
