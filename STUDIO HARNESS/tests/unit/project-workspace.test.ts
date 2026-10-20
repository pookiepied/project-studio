import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { StudioRuntime } from "../../src/application/studio-runtime.js";
import type { SecureCredentialStore } from "../../src/credentials/credential-store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationScratchDirectory,
  conversationWorkspaceDirectory,
} from "../../src/platform/paths.js";
import { ProjectStore } from "../../src/projects/store.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { SandboxError } from "../../src/sandbox/errors.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * Where a turn stands, at the level the run actually happens.
 *
 * A conversation filed under a project with folders runs in the project's
 * first folder, reaches the others as roots, and reports itself as a project;
 * everything else - no project, or a project that is only a label - keeps the
 * conversation tree of its own. These tests drive the real runtime, store,
 * and disk: the sandbox is built the way the render builds it, and every
 * directory a test touches is one the test created or the harness was going
 * to create anyway.
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
  readonly scopes: SandboxScopeStore;
  /** The temp directory everything real was created under. */
  readonly root: string;
}

let previousHome: string | undefined;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  previousHome = undefined;

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "studio-project-workspace-"));
  temporaryDirectories.push(root);
  previousHome = process.env.PROJECT_STUDIO_HOME;
  process.env.PROJECT_STUDIO_HOME = join(root, "home");

  const database = openDatabase({ path: join(root, "studio.db") });
  const runtime = new StudioRuntime({ database, credentials });
  return {
    runtime,
    database,
    projects: new ProjectStore(database),
    conversations: new ConversationStore(database),
    scopes: new SandboxScopeStore(database),
    root,
  };
}

async function stop(harnessState: Harness): Promise<void> {
  await harnessState.runtime.stop();
  harnessState.database.close();
}

/**
 * The sandbox environment, built the way the agent render builds it: the
 * factory gets the conversation's id and the root the render would pass,
 * which for a project conversation is its first folder.
 */
async function environmentFor(
  harnessState: Harness,
  conversationId: string,
): Promise<Awaited<ReturnType<ReturnType<StudioRuntime["createAgentSandbox"]>["createSandbox"]>>> {
  const folders = harnessState.runtime.conversationProjectFolders(conversationId);
  const workspace = folders[0] ?? conversationWorkspaceDirectory(conversationId);
  const factory = harnessState.runtime.createAgentSandbox({
    agentId: "studio",
    conversationId,
    projectRoot: workspace,
  });
  return factory.createSandbox({ id: conversationId });
}

async function makeDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

describe("a project conversation stands in the project's folders", () => {
  it("refuses coordination of another conversation's worker before dispatch", async () => {
    const state = await harness();
    try {
      state.runtime.tasks.record({ id: "worker", agentName: "voice-work", parentConversationId: "owner" });
      await expect(state.runtime.coordinateTask("other", "worker", "steer", "Change it")).rejects.toThrow(/not an independently addressable worker/);
      expect(state.runtime.tasks.get("worker")?.status).toBe("running");
    } finally { await stop(state); }
  });

  it("exposes only scoped image observation in the voice sandbox", async () => {
    const state = await harness();
    try {
      state.conversations.record({ id: "voice", firstMessage: "Hello" });
      const factory = state.runtime.createAgentSandbox({ agentId: "voice", conversationId: "voice", voiceOnly: true });
      const environment = await factory.createSandbox({ id: "voice" });
      const tools = factory.tools?.(environment, { subagents: {} });
      expect(tools?.map((tool) => tool.name)).toEqual(["read"]);
      const reader = tools?.find((tool) => tool.name === "read");
      await expect(reader?.execute("call", { path: join(conversationWorkspaceDirectory("voice"), "private.txt") })).rejects.toThrow(/only images/);
    } finally { await stop(state); }
  });

  it("runs with the first folder as its sandbox root, so the kind comparison answers project", async () => {
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const second = await makeDirectory(join(state.root, "assets"));
      const project = state.projects.create({
        id: "prj_main",
        name: "Main",
        icon: "arc",
        folders: [
          { name: "repo", path: first },
          { name: "assets", path: second },
        ],
      });
      state.conversations.record({
        id: "cnv_proj",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const env = await environmentFor(state, "cnv_proj");
      expect(env.cwd).toBe(resolve(first));
      // The render derives the kind by comparing where it stands with the
      // conversation's own tree. The two have diverged here, which is what
      // makes the run a project run without anything remembering to say so.
      expect(env.cwd).not.toBe(conversationWorkspaceDirectory("cnv_proj"));
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("derives the project's first folder when the factory is called without a root", async () => {
    // The render passes the root it derived from the same host method, so a
    // factory that ignored its own derivation would still look right through
    // the render's path. Called bare - the way any non-render caller reaches
    // it - the factory has to know where the project is itself.
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const project = state.projects.create({
        id: "prj_bare",
        name: "Bare",
        icon: "arc",
        folders: [{ name: "repo", path: first }],
      });
      state.conversations.record({
        id: "cnv_bare",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const factory = state.runtime.createAgentSandbox({
        agentId: "studio",
        conversationId: "cnv_bare",
      });
      const env = await factory.createSandbox({ id: "cnv_bare" });
      expect(env.cwd).toBe(resolve(first));
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("reads and writes the project's other folders, and the first", async () => {
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const second = await makeDirectory(join(state.root, "assets"));
      const project = state.projects.create({
        id: "prj_roots",
        name: "Roots",
        icon: "arc",
        folders: [
          { name: "repo", path: first },
          { name: "assets", path: second },
        ],
      });
      state.conversations.record({
        id: "cnv_roots",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const env = await environmentFor(state, "cnv_roots");
      await env.writeFile(join(second, "planted.txt"), "from the conversation");
      expect(await readFile(join(second, "planted.txt"), "utf8")).toBe(
        "from the conversation",
      );
      expect(await env.readFile(join(second, "planted.txt"))).toBe(
        "from the conversation",
      );
      // The working directory is writable too - it is the person's folder,
      // and it is where the work happens.
      await env.writeFile(join(first, "note.txt"), "in the root");
      expect(existsSync(join(first, "note.txt"))).toBe(true);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("still refuses a path outside every root", async () => {
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const second = await makeDirectory(join(state.root, "assets"));
      const outside = await makeDirectory(join(state.root, "elsewhere"));
      const project = state.projects.create({
        id: "prj_wall",
        name: "Wall",
        icon: "arc",
        folders: [
          { name: "repo", path: first },
          { name: "assets", path: second },
        ],
      });
      state.conversations.record({
        id: "cnv_wall",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const env = await environmentFor(state, "cnv_wall");
      await expect(env.writeFile(join(outside, "planted.txt"), "x")).rejects.toThrow(
        SandboxError,
      );
      expect(existsSync(join(outside, "planted.txt"))).toBe(false);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("still creates the conversation's own directories", async () => {
    // The conversation tree does not disappear: an attachment does not belong
    // in the person's repository, and an artifact does not belong in it
    // either. Only the sandbox root's meaning changed, not who owns what.
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const project = state.projects.create({
        id: "prj_tree",
        name: "Tree",
        icon: "arc",
        folders: [{ name: "repo", path: first }],
      });
      state.conversations.record({
        id: "cnv_tree",
        firstMessage: "Hello",
        projectId: project.id,
      });

      await environmentFor(state, "cnv_tree");
      expect(existsSync(conversationAttachmentsDirectory("cnv_tree"))).toBe(true);
      expect(existsSync(conversationArtifactsDirectory("cnv_tree"))).toBe(true);
      // The scratch directory exists in both modes: it is the one place the
      // model may leave working files whatever it is standing in.
      expect(existsSync(conversationScratchDirectory("cnv_tree"))).toBe(true);
      // And `workspace/` does not, because this conversation stands in the
      // person's repository. Creating it here would leave a folder nothing
      // writes to and nobody can explain - a third place in a design that has
      // two. It is made only when it is the working directory.
      expect(existsSync(conversationWorkspaceDirectory("cnv_tree"))).toBe(false);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("refuses the turn when the first folder is missing, names the project, and never creates it", async () => {
    const state = await harness();
    try {
      const ghost = join(state.root, "ghost");
      await mkdir(ghost, { recursive: true });
      const project = state.projects.create({
        id: "prj_ghost",
        name: "Ghostly",
        icon: "arc",
        folders: [{ name: "ghost", path: ghost }],
      });
      await rm(ghost, { recursive: true, force: true });
      state.conversations.record({
        id: "cnv_ghost",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const factory = state.runtime.createAgentSandbox({
        agentId: "studio",
        conversationId: "cnv_ghost",
      });
      const outcome = await factory
        .createSandbox({ id: "cnv_ghost" })
        .then(
          () => "started",
          (error: unknown) => error,
        );
      const refusal = outcome instanceof SandboxError ? outcome : undefined;
      expect(refusal?.kind).toBe("unavailable");
      expect(refusal?.message).toContain("Ghostly");
      expect(refusal?.message).toContain(ghost);
      expect(refusal?.message).toMatch(/missing/);
      // The folder is the person's. A refusal that quietly made it would be
      // the failure this rule exists to prevent.
      expect(existsSync(ghost)).toBe(false);
      // Refusing the turn creates nothing: not even the conversation's tree,
      // which only comes into existence on an admitted submission.
      expect(existsSync(conversationWorkspaceDirectory("cnv_ghost"))).toBe(false);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("refuses the turn when a file sits where the first folder should be", async () => {
    const state = await harness();
    try {
      const impostor = join(state.root, "impostor");
      await mkdir(impostor, { recursive: true });
      const project = state.projects.create({
        id: "prj_file",
        name: "Filey",
        icon: "arc",
        folders: [{ name: "impostor", path: impostor }],
      });
      await rm(impostor, { recursive: true, force: true });
      await writeFile(impostor, "not a directory");
      state.conversations.record({
        id: "cnv_file",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const factory = state.runtime.createAgentSandbox({
        agentId: "studio",
        conversationId: "cnv_file",
      });
      const outcome = await factory
        .createSandbox({ id: "cnv_file" })
        .then(
          () => "started",
          (error: unknown) => error,
        );
      const refusal = outcome instanceof SandboxError ? outcome : undefined;
      expect(refusal?.message).toContain("Filey");
      expect(refusal?.message).toMatch(/file where its folder/i);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("applies machine-wide scope rows to a project conversation", async () => {
    // Task 57's store-level test pins that machine-wide rows resolve for any
    // project; this pins the same thing where it becomes reach.
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const shared = await makeDirectory(join(state.root, "shared-tool"));
      await writeFile(join(shared, "tool.json"), "{}");
      state.scopes.grant({
        projectId: "",
        path: shared,
        mode: "read",
        source: "custom",
      });
      const project = state.projects.create({
        id: "prj_wide",
        name: "Wide",
        icon: "arc",
        folders: [{ name: "repo", path: first }],
      });
      state.conversations.record({
        id: "cnv_wide",
        firstMessage: "Hello",
        projectId: project.id,
      });

      const env = await environmentFor(state, "cnv_wide");
      expect(await env.readFile(join(shared, "tool.json"))).toBe("{}");
      // Read-only means read-only, even for the project's own conversation.
      await expect(env.writeFile(join(shared, "w.txt"), "x")).rejects.toThrow(
        SandboxError,
      );
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("applies a conversation grant to that conversation, and clears a decline at the next run", async () => {
    // The two halves of the folder question's memory (ADR 0057): a yes for
    // this conversation is a row it reads at every run; a no is held only
    // for the turn that heard it, so "try again" in the next message asks
    // again.
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const downloads = await makeDirectory(join(state.root, "downloads"));
      await writeFile(join(downloads, "model.bin"), "x");
      const project = state.projects.create({
        id: "prj_cnv",
        name: "Cnv",
        icon: "arc",
        folders: [{ name: "repo", path: first }],
      });
      state.conversations.record({ id: "cnv_one", firstMessage: "Hello", projectId: project.id });
      state.conversations.record({ id: "cnv_two", firstMessage: "Hello", projectId: project.id });
      state.scopes.grant({
        projectId: "",
        conversationId: "cnv_one",
        path: downloads,
        mode: "read",
        source: "question",
      });

      const one = await environmentFor(state, "cnv_one");
      expect(await one.readFile(join(downloads, "model.bin"))).toBe("x");
      const two = await environmentFor(state, "cnv_two");
      await expect(two.readFile(join(downloads, "model.bin"))).rejects.toThrow(SandboxError);

      state.runtime.markScopeDeclined("cnv_two", downloads);
      expect(state.runtime.scopeDeclined("cnv_two", downloads)).toBe(true);
      // The next run - the person's next message - starts clean.
      await environmentFor(state, "cnv_two");
      expect(state.runtime.scopeDeclined("cnv_two", downloads)).toBe(false);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("takes the first folder by position, not by insertion", async () => {
    const state = await harness();
    try {
      const first = await makeDirectory(join(state.root, "repo"));
      const second = await makeDirectory(join(state.root, "assets"));
      const project = state.projects.create({
        id: "prj_order",
        name: "Order",
        icon: "arc",
        folders: [
          { name: "repo", path: first },
          { name: "assets", path: second },
        ],
      });
      state.database
        .prepare("UPDATE project_folder SET position = ? WHERE project_id = ? AND name = ?")
        .run(5, project.id, "repo");
      state.database
        .prepare("UPDATE project_folder SET position = ? WHERE project_id = ? AND name = ?")
        .run(2, project.id, "assets");

      expect(state.runtime.conversationProjectFolders("cnv_none")).toEqual([]);
      state.conversations.record({
        id: "cnv_order",
        firstMessage: "Hello",
        projectId: project.id,
      });
      // The person put assets first; first means first as they arranged it.
      expect(state.runtime.conversationProjectFolders("cnv_order")).toEqual([
        resolve(second),
        resolve(first),
      ]);
      const env = await environmentFor(state, "cnv_order");
      expect(env.cwd).toBe(resolve(second));
    } finally {
      await stop(state);
    }
  }, 30_000);
});

describe("a conversation without a project is unchanged", () => {
  it("stands in its own conversation directory", async () => {
    const state = await harness();
    try {
      state.conversations.record({ id: "cnv_loose", firstMessage: "Hello" });

      const env = await environmentFor(state, "cnv_loose");
      expect(env.cwd).toBe(conversationWorkspaceDirectory("cnv_loose"));
      expect(existsSync(conversationAttachmentsDirectory("cnv_loose"))).toBe(true);
      expect(existsSync(conversationArtifactsDirectory("cnv_loose"))).toBe(true);
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("a project with no folders is the same: a label, not a place", async () => {
    const state = await harness();
    try {
      const project = state.projects.create({
        id: "prj_label",
        name: "Label",
        icon: "arc",
      });
      state.conversations.record({
        id: "cnv_label",
        firstMessage: "Hello",
        projectId: project.id,
      });

      expect(state.runtime.conversationProjectFolders("cnv_label")).toEqual([]);
      const env = await environmentFor(state, "cnv_label");
      expect(env.cwd).toBe(conversationWorkspaceDirectory("cnv_label"));
    } finally {
      await stop(state);
    }
  }, 30_000);

  it("its own workspace stays writable when a machine-wide write grant exists", async () => {
    // Found while landing the folders: the policy replaces its default write
    // set with whatever the composition passes, so once any scope write row
    // existed, the conversation's own directory - ours, and the one place a
    // scratch file belongs - dropped out of the writable set. The workspace
    // root now leads the write roots explicitly.
    const state = await harness();
    try {
      const shared = await makeDirectory(join(state.root, "cargo-home"));
      state.scopes.grant({
        projectId: "",
        path: shared,
        mode: "write",
        source: "custom",
      });
      state.conversations.record({ id: "cnv_scratch", firstMessage: "Hello" });

      const env = await environmentFor(state, "cnv_scratch");
      await env.writeFile(
        join(conversationWorkspaceDirectory("cnv_scratch"), "scratch.txt"),
        "mine",
      );
      expect(
        existsSync(join(conversationWorkspaceDirectory("cnv_scratch"), "scratch.txt")),
      ).toBe(true);
      await env.writeFile(join(shared, "granted.txt"), "also mine");
      expect(existsSync(join(shared, "granted.txt"))).toBe(true);
    } finally {
      await stop(state);
    }
  }, 30_000);
});
