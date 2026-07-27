import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { SandboxError } from "../../../src/sandbox/errors.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { ToolError } from "../../../src/tools/errors.js";
import { CallGate } from "../../../src/tools/gate.js";
import {
  FileAccessLog,
  formatNumbered,
  registerFilesystemTools,
} from "../../../src/tools/filesystem/index.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

const OTHER_CONVERSATION: ExecutionScope = { ...SCOPE, conversationId: "conv-2" };

let db: StudioDatabase;
let workspace: string;
let gate: CallGate;
let log: FileAccessLog;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-fs-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "app.ts"), "const a = 1;\nconst b = 2;\n");

  const kernel = new PermissionKernel({
    grants: new PermissionGrantStore(db),
    // Writing asks by default; an always-approving user keeps these tests about
    // the tools rather than about the prompt.
    approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
  });
  gate = new CallGate({
    kernel,
    sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
  });
  log = registerFilesystemTools(gate);
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

const read = (input: unknown, scope = SCOPE) =>
  gate.call({ name: "native/read", input, scope }) as Promise<string>;
const write = (input: unknown, scope = SCOPE) =>
  gate.call({ name: "native/write", input, scope }) as Promise<string>;
const edit = (input: unknown, scope = SCOPE) =>
  gate.call({ name: "native/edit", input, scope }) as Promise<string>;

describe("read", () => {
  it("returns numbered lines", async () => {
    // Line numbers are how the model refers to a location afterwards, and how a
    // person checks that an edit points where it claims.
    const output = await read({ path: "src/app.ts" });

    expect(output).toContain("     1\tconst a = 1;");
    expect(output).toContain("     2\tconst b = 2;");
  });

  it("pages with offset and limit", async () => {
    writeFileSync(join(workspace, "long.txt"), "a\nb\nc\nd\ne\n");

    const output = await read({ path: "long.txt", offset: 2, limit: 2 });

    expect(output).toContain("     2\tb");
    expect(output).toContain("     3\tc");
    expect(output).not.toContain("     4\td");
  });

  it("says when it returned only part of a file", async () => {
    // A model that does not know it saw a fragment answers as though it saw
    // the whole file.
    writeFileSync(join(workspace, "long.txt"), "a\nb\nc\nd\ne\n");

    expect(await read({ path: "long.txt", limit: 2 })).toMatch(/showing lines 1-2 of 5/);
  });

  it("truncates a line too long to be worth reasoning about", () => {
    const output = formatNumbered("x".repeat(5_000), 1, 10);

    expect(output).toContain("[line truncated]");
    expect(output.length).toBeLessThan(3_000);
  });

  it("reports an empty file as empty rather than as nothing", () => {
    expect(formatNumbered("", 1, 10)).toBe("(this file is empty)");
  });

  it("refuses a directory", async () => {
    await expect(read({ path: "src" })).rejects.toThrow(/directory/i);
  });

  it("refuses a file that is not text", async () => {
    // Returned as text, binary becomes plausible-looking nonsense the model
    // reasons about as if it were real.
    writeFileSync(join(workspace, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));

    await expect(read({ path: "image.png" })).rejects.toThrow(/not text/i);
  });

  it("refuses a file too large to read at once", async () => {
    writeFileSync(join(workspace, "big.txt"), "x".repeat(2 * 1024 * 1024));

    await expect(read({ path: "big.txt" })).rejects.toThrow(/too large/i);
  });

  it("refuses a path outside the workspace", async () => {
    await expect(read({ path: "../escape.txt" })).rejects.toThrow(SandboxError);
  });

  it("requires a path", async () => {
    await expect(read({})).rejects.toThrow(/path is required/i);
  });
});

describe("write", () => {
  it("creates a file that does not exist, with no prior read", async () => {
    // Requiring a read of a missing file would make creating one impossible.
    expect(await write({ path: "notes/new.md", content: "hello" })).toMatch(/created/i);
    expect(await read({ path: "notes/new.md" })).toContain("hello");
  });

  it("refuses to replace a file this conversation has not read", async () => {
    // A model that has not read a file does not know what it is discarding.
    await expect(
      write({ path: "src/app.ts", content: "wiped" }),
    ).rejects.toThrow(/has not been read/i);

    expect(await read({ path: "src/app.ts" })).toContain("const a = 1;");
  });

  it("replaces it once the file has been read", async () => {
    await read({ path: "src/app.ts" });

    expect(await write({ path: "src/app.ts", content: "replaced" })).toMatch(/replaced/i);
  });

  it("does not accept a read from a different conversation", async () => {
    // "I have seen this file" is knowledge held by one agent in one
    // conversation; inheriting it would let another edit blind.
    await read({ path: "src/app.ts" }, OTHER_CONVERSATION);

    await expect(write({ path: "src/app.ts", content: "wiped" })).rejects.toThrow(
      /has not been read/i,
    );
  });

  it("refuses when the file changed after it was read", async () => {
    // Editing against a stale copy silently discards whatever happened in
    // between — a formatter run, another tool, the user typing.
    await read({ path: "src/app.ts" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    writeFileSync(join(workspace, "src", "app.ts"), "changed by someone else");

    await expect(write({ path: "src/app.ts", content: "mine" })).rejects.toThrow(
      /changed after it was read/i,
    );
  });

  it("refuses a path outside the workspace", async () => {
    await expect(write({ path: "../planted.txt", content: "x" })).rejects.toThrow(
      SandboxError,
    );
  });

  it("requires text content", async () => {
    await expect(write({ path: "a.txt", content: 42 })).rejects.toThrow(/must be text/i);
  });
});

describe("edit", () => {
  beforeEach(async () => {
    await read({ path: "src/app.ts" });
  });

  it("replaces an exact string", async () => {
    await edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 9;" });

    expect(await read({ path: "src/app.ts" })).toContain("const a = 9;");
  });

  it("refuses text that is not in the file", async () => {
    await expect(
      edit({ path: "src/app.ts", oldString: "missing", newString: "x" }),
    ).rejects.toThrow(/was not found/i);
  });

  it("refuses an ambiguous match rather than guessing", async () => {
    // Three occurrences means the model has not said which one it meant, and
    // picking the first is a guess with a one-in-three chance.
    writeFileSync(join(workspace, "dup.ts"), "x = 1\nx = 1\nx = 1\n");
    await read({ path: "dup.ts" });

    await expect(
      edit({ path: "dup.ts", oldString: "x = 1", newString: "x = 2" }),
    ).rejects.toThrow(/appears 3 times/i);
  });

  it("changes every occurrence when told to", async () => {
    writeFileSync(join(workspace, "dup.ts"), "x = 1\nx = 1\n");
    await read({ path: "dup.ts" });

    expect(
      await edit({ path: "dup.ts", oldString: "x = 1", newString: "x = 2", replaceAll: true }),
    ).toMatch(/2 occurrences/);
  });

  it("refuses an edit that changes nothing", async () => {
    await expect(
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 1;" }),
    ).rejects.toThrow(/identical/i);
  });

  it("refuses an empty oldString", async () => {
    await expect(
      edit({ path: "src/app.ts", oldString: "", newString: "x" }),
    ).rejects.toThrow(/cannot be empty/i);
  });

  it("refuses a file that does not exist", async () => {
    await expect(
      edit({ path: "nope.ts", oldString: "a", newString: "b" }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("refuses a file this conversation has not read", async () => {
    writeFileSync(join(workspace, "unread.ts"), "value");

    await expect(
      edit({ path: "unread.ts", oldString: "value", newString: "other" }),
    ).rejects.toThrow(/has not been read/i);
  });
});

describe("the three tools share one record of what was read", () => {
  it("lets an edit follow a write with no re-read", async () => {
    // A file the model just wrote is a file it knows the contents of.
    await write({ path: "fresh.ts", content: "start" });

    expect(
      await edit({ path: "fresh.ts", oldString: "start", newString: "finished" }),
    ).toMatch(/edited/i);
  });

  it("lets an edit follow an edit with no re-read", async () => {
    await read({ path: "src/app.ts" });
    await edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 2;" });

    expect(
      await edit({ path: "src/app.ts", oldString: "const a = 2;", newString: "const a = 3;" }),
    ).toMatch(/edited/i);
  });

  it("forgets a conversation when it ends", () => {
    const standalone = new FileAccessLog();
    standalone.record(SCOPE, "C:/x/a.ts", { modifiedAt: 1, existed: true });
    standalone.forget(SCOPE.conversationId);

    expect(standalone.get(SCOPE, "C:/x/a.ts")).toBeUndefined();
  });
});

describe("every tool goes through the gate", () => {
  it("registers exactly the three filesystem capabilities", () => {
    // No `list` tool: glob covers it, and two ways to enumerate a directory is
    // one more permission surface than the capability needs.
    expect(gate.list().map((tool) => tool.id.name).sort()).toEqual([
      "edit",
      "read",
      "write",
    ]);
  });

  it("declares reading as read-only and the others as writing", () => {
    const byName = new Map(gate.list().map((tool) => [tool.id.name, tool.effects]));

    expect(byName.get("read")).toEqual(["read"]);
    expect(byName.get("write")).toEqual(["write"]);
    expect(byName.get("edit")).toEqual(["write"]);
  });

  it("marks edit as not idempotent, because reapplying it fails", () => {
    // The old string is gone the second time. A correct refusal, not a safe
    // retry — which matters when a call fails with an unknown outcome.
    const edit = gate.list().find((tool) => tool.id.name === "edit");

    expect(edit?.idempotent).toBe(false);
  });

  it("surfaces a bad argument as a tool error, not a crash", async () => {
    await expect(read({ path: "src/app.ts", offset: 0 })).rejects.toThrow(ToolError);
  });
});
