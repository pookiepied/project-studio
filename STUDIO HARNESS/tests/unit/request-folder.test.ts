import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClosingTurns } from "../../src/execution/closing-turns.js";
import type { QuestionReport } from "../../src/questions/question.js";
import { SandboxError } from "../../src/sandbox/errors.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import {
  buildScopeQuestion,
  ScopeDeclines,
  SCOPE_QUESTION_OPTIONS,
} from "../../src/sandbox/scope-questions.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { ToolError } from "../../src/tools/errors.js";
import { createRequestFolderTool, REQUEST_FOLDER_DESCRIPTOR } from "../../src/tools/ask/folder.js";

const CONVERSATION = "cnv_folder";

let db: StudioDatabase;
let base = "";

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  base = mkdtempSync(join(tmpdir(), "studio-folder-"));
});

afterEach(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function folder(name: string): string {
  const directory = join(base, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function harness(options: {
  readonly answer?: Partial<QuestionReport> | undefined;
  readonly projectId?: string | undefined;
  readonly trusted?: boolean;
}) {
  const workspace = folder("workspace");
  const sandbox = new LocalSandbox(
    createSandboxPolicy({ workspaceRoot: workspace, ...(options.trusted ? { trusted: true } : {}) }),
  );
  const scopes = new SandboxScopeStore(db);
  const declines = new ScopeDeclines();
  const closing = new ClosingTurns();
  const asked: string[] = [];
  const tool = createRequestFolderTool({
    ask: (_conversation, questions) => {
      asked.push(...questions.map((question) => question.question));
      if (options.answer === undefined) return Promise.resolve(undefined);
      const first = questions[0];
      return Promise.resolve([
        {
          header: first?.header ?? "Folder",
          question: first?.question ?? "",
          outcome: "answered",
          ...options.answer,
        },
      ]);
    },
    closing,
    scopes,
    declines,
    projectOf: () => options.projectId,
  });
  const context = {
    scope: { agentId: "studio", conversationId: CONVERSATION, projectId: options.projectId ?? "key" },
    sandbox,
    signal: undefined,
  };
  return { tool, context, sandbox, scopes, declines, closing, asked, workspace };
}

describe("the folder question", () => {
  it("offers two ways to say yes with a project, and one without", () => {
    const withProject = buildScopeQuestion({ resolvedPath: base, reason: "To read the export.", hasProject: true });
    expect(withProject.payload.options.map((option) => option.id)).toEqual([
      SCOPE_QUESTION_OPTIONS.project,
      SCOPE_QUESTION_OPTIONS.everywhere,
      SCOPE_QUESTION_OPTIONS.deny,
    ]);
    expect(withProject.payload.question).toContain("To read the export.");

    const without = buildScopeQuestion({ resolvedPath: base, hasProject: false });
    expect(without.payload.options.map((option) => option.id)).toEqual([
      SCOPE_QUESTION_OPTIONS.everywhere,
      SCOPE_QUESTION_OPTIONS.deny,
    ]);
    expect(without.payload.question).toContain("outside this conversation's folders");
  });
});

describe("request_folder", () => {
  it("declares read and nothing else, so asking never needs approval", () => {
    expect(REQUEST_FOLDER_DESCRIPTOR.effects).toEqual(["read"]);
    expect(REQUEST_FOLDER_DESCRIPTOR.id).toEqual({ namespace: "native", name: "request_folder" });
  });

  it("refuses a relative path, a missing mode, and a missing reason", () => {
    const { tool } = harness({});
    expect(() => tool.parse({ path: "downloads", mode: "read", reason: "x" })).toThrow(ToolError);
    expect(() => tool.parse({ path: base, mode: "append", reason: "x" })).toThrow(ToolError);
    expect(() => tool.parse({ path: base, mode: "read" })).toThrow(ToolError);
  });

  it("writes the grant, widens this run, and says so, when the person allows it for the project", async () => {
    const downloads = folder("Downloads");
    const { tool, context, sandbox, scopes, asked } = harness({
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.project] },
      projectId: "prj_a",
    });

    expect(() => sandbox.resolveWrite(join(downloads, "model.bin"))).toThrow(SandboxError);

    const report = await tool.execute(
      tool.parse({ path: downloads, mode: "write", reason: "To save the downloaded model." }),
      context,
    );

    expect(report.outcome).toBe("granted");
    expect(report.message).toContain("for this project");
    expect(asked[0]).toContain(resolve(downloads));
    expect(asked[0]).toContain("To save the downloaded model.");
    // The row the next run reads.
    expect(scopes.resolveRoots("prj_a").writeRoots).toContain(resolve(downloads));
    // And this run reaches it already.
    expect(sandbox.resolveWrite(join(downloads, "model.bin"))).toBe(resolve(downloads, "model.bin"));
  });

  it("writes the machine-wide row for a conversation with no project", async () => {
    const data = folder("data");
    const { tool, context, scopes } = harness({
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.everywhere] },
      projectId: undefined,
    });

    const report = await tool.execute(
      tool.parse({ path: data, mode: "read", reason: "To read the CSV." }),
      context,
    );

    expect(report.outcome).toBe("granted");
    expect(report.message).toContain("machine-wide");
    expect(scopes.resolveRoots(undefined).readRoots).toContain(resolve(data));
    expect(scopes.resolveRoots(undefined).writeRoots).not.toContain(resolve(data));
  });

  it("remembers a no for the conversation and does not ask again", async () => {
    const data = folder("data");
    const { tool, context, declines, asked } = harness({
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.deny] },
      projectId: "prj_a",
    });
    const input = tool.parse({ path: data, mode: "read", reason: "To read the CSV." });

    const first = await tool.execute(input, context);
    expect(first.outcome).toBe("declined");
    expect(declines.isDeclined(CONVERSATION, data)).toBe(true);

    const second = await tool.execute(input, context);
    expect(second.outcome).toBe("declined");
    expect(asked).toHaveLength(1);
  });

  it("answers without asking when the folder is already in reach", async () => {
    const { tool, context, asked, workspace } = harness({ projectId: "prj_a" });
    const inside = join(workspace, "src");
    mkdirSync(inside);

    const report = await tool.execute(
      tool.parse({ path: inside, mode: "write", reason: "To write here." }),
      context,
    );

    expect(report.outcome).toBe("already-reachable");
    expect(asked).toHaveLength(0);
  });

  it("asks when the folder is readable but write was asked for", async () => {
    const data = folder("data");
    const { tool, context, asked, sandbox } = harness({
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.project] },
      projectId: "prj_a",
    });
    sandbox.widen(data, "read");

    const report = await tool.execute(
      tool.parse({ path: data, mode: "write", reason: "To write results." }),
      context,
    );

    expect(report.outcome).toBe("granted");
    expect(asked).toHaveLength(1);
  });

  it("refuses a volume root, a missing folder, and a file, before anyone is asked", async () => {
    const { tool, context, asked } = harness({ projectId: "prj_a" });
    const file = join(base, "notes.txt");
    writeFileSync(file, "x");
    const root = resolve("/");

    await expect(
      tool.execute(tool.parse({ path: root, mode: "read", reason: "Everything." }), context),
    ).rejects.toThrow(ToolError);
    await expect(
      tool.execute(tool.parse({ path: join(base, "nope"), mode: "read", reason: "x" }), context),
    ).rejects.toThrow(/does not exist/);
    await expect(
      tool.execute(tool.parse({ path: file, mode: "read", reason: "x" }), context),
    ).rejects.toThrow(/is a file/);
    expect(asked).toHaveLength(0);
  });

  it("passes the person's own words along and grants nothing", async () => {
    const data = folder("data");
    const { tool, context, scopes } = harness({
      answer: { text: "Use the export folder instead." },
      projectId: "prj_a",
    });

    const report = await tool.execute(
      tool.parse({ path: data, mode: "read", reason: "To read the CSV." }),
      context,
    );

    expect(report.outcome).toBe("unanswered");
    expect(report.text).toBe("Use the export folder instead.");
    expect(scopes.resolveRoots("prj_a").readRoots).not.toContain(resolve(data));
  });

  it("arms the closing turn when the person stops the run", async () => {
    const data = folder("data");
    const { tool, context, closing } = harness({
      answer: { outcome: "stopped" },
      projectId: "prj_a",
    });

    const report = await tool.execute(
      tool.parse({ path: data, mode: "read", reason: "To read the CSV." }),
      context,
    );

    expect(report.outcome).toBe("stopped");
    expect(report.closing).toBeDefined();
    expect(closing.isArmed(CONVERSATION)).toBe(true);
  });
});

describe("LocalSandbox.widen", () => {
  it("adds a read root, and a write root only for write", () => {
    const workspace = folder("workspace");
    const data = folder("data");
    const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));

    sandbox.widen(data, "read");
    expect(sandbox.resolveRead(join(data, "a.csv"))).toBe(resolve(data, "a.csv"));
    expect(() => sandbox.resolveWrite(join(data, "a.csv"))).toThrow(SandboxError);

    sandbox.widen(data, "write");
    expect(sandbox.resolveWrite(join(data, "a.csv"))).toBe(resolve(data, "a.csv"));
    // Once each, not once per call.
    expect(sandbox.policy.readRoots.filter((root) => root === resolve(data))).toHaveLength(1);
  });

  it("leaves a trusted sandbox as it is", () => {
    const workspace = folder("workspace");
    const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace, trusted: true }));
    const before = sandbox.policy;
    sandbox.widen(folder("data"), "write");
    expect(sandbox.policy).toBe(before);
  });
});
