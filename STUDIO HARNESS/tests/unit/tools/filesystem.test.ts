import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  registerFilesystemTools(gate);
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
    // reasons about as if it were real. Not a .png - a picture is no longer
    // "not text", it is an attachment.
    writeFileSync(join(workspace, "data.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));

    await expect(read({ path: "data.bin" })).rejects.toThrow(/not text/i);
  });

  it("suggests near misses when a path does not exist", async () => {
    // A missing file is the most common failure a read has, and the name
    // usually differs by a typo, a case, or an extension.
    await expect(read({ path: "src/ap.ts" })).rejects.toThrow(/Did you mean[\s\S]*app\.ts/);
    await expect(read({ path: "src/app.tsx" })).rejects.toThrow(/Did you mean[\s\S]*app\.ts/);
  });

  it("says there is no file when there is nothing to suggest", async () => {
    // No parent directory to look in, so no near miss either.
    await expect(read({ path: "nowhere/thing.ts" })).rejects.toThrow(
      /There is no file at nowhere\/thing\.ts/,
    );
  });

  it("does not suggest an unrelated name just because a dotfile stems to empty", async () => {
    // `.env` stems to "", and includes("") matched everything once. The plain
    // refusal, anchored exactly, proves no suggestion block was appended.
    writeFileSync(join(workspace, ".env"), "X=1\n");

    await expect(read({ path: "unrelated-thing.bin" })).rejects.toThrow(
      /^There is no file at unrelated-thing\.bin\.$/,
    );
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

describe("read sees pictures", () => {
  // A 1x1 PNG. The bytes are decoded and re-encoded by the tool, so asserting
  // the base64 round-trips proves the file reached the model intact.
  const TINY_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  function pictureGate(acceptsImages: (conversationId: string) => boolean | undefined): CallGate {
    const instance = new CallGate({
      kernel: new PermissionKernel({
        grants: new PermissionGrantStore(db),
        approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
      }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
    });
    registerFilesystemTools(instance, new FileAccessLog(), { acceptsImages });
    return instance;
  }

  function contentBlocksOf(value: unknown): readonly unknown[] | undefined {
    if (typeof value !== "object" || value === null || !("content" in value)) return undefined;
    const content = value.content;
    return Array.isArray(content) ? content : undefined;
  }

  function isImageBlock(
    block: unknown,
  ): block is { type: "image"; data: string; mimeType: string } {
    return (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "image" &&
      "data" in block &&
      "mimeType" in block
    );
  }

  beforeEach(() => {
    writeFileSync(join(workspace, "logo.png"), Buffer.from(TINY_PNG, "base64"));
  });

  it("returns an image as an attachment when the model can see it", async () => {
    const result = await pictureGate(() => true).call({
      name: "native/read",
      input: { path: "logo.png" },
      scope: SCOPE,
    });

    const blocks = contentBlocksOf(result);
    expect(blocks).toHaveLength(2);
    const image = blocks?.find(isImageBlock);
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data).toBe(TINY_PNG);
  });

  it("returns the attachment when acceptance is merely unknown", async () => {
    // The catalog not describing a model is not evidence that the model is
    // blind; only an explicit "unsupported" refuses.
    const result = await pictureGate(() => undefined).call({
      name: "native/read",
      input: { path: "logo.png" },
      scope: SCOPE,
    });

    expect(contentBlocksOf(result)).toHaveLength(2);
  });

  it("refuses with a sentence rather than a wall of base64 for a text-only model", async () => {
    await expect(
      pictureGate(() => false).call({
        name: "native/read",
        input: { path: "logo.png" },
        scope: SCOPE,
      }),
    ).rejects.toThrow(/does not accept image input/);
  });

  it("refuses a PDF, which nothing downstream can carry yet", async () => {
    writeFileSync(join(workspace, "doc.pdf"), Buffer.from("%PDF-1.4\n"));

    await expect(read({ path: "doc.pdf" })).rejects.toThrow(/PDF/);
  });

  it("keeps the read recorded, so the access log stays the one answer", async () => {
    const log = new FileAccessLog();
    const instance = new CallGate({
      kernel: new PermissionKernel({
        grants: new PermissionGrantStore(db),
        approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
      }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
    });
    registerFilesystemTools(instance, log, { acceptsImages: () => true });

    await instance.call({ name: "native/read", input: { path: "logo.png" }, scope: SCOPE });

    expect(log.get(SCOPE, join(workspace, "logo.png"))).toBeDefined();
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

  // `String.replace` treats the replacement as a pattern even when the search
  // value is a plain string, so these all used to write something other than
  // what was asked for and report success. `$` is ordinary content in a file.
  describe("writes the replacement exactly as given", () => {
    const cases: readonly (readonly [name: string, newString: string])[] = [
      ["$& (the whole match)", "cost + $&"],
      ["$` (everything before)", "cost + $`"],
      ["$' (everything after)", "cost + $'"],
      ["$$ (an escaped dollar)", "cost + $$"],
      // These two are already inert, because a string search value has no
      // capture groups for them to refer to. Kept anyway: they become live the
      // moment anyone reaches for a RegExp here, and this is where that shows
      // up as a failure rather than as a corrupted file.
      ["$1 (a capture group)", "cost + $1"],
      ["$<name> (a named group)", "cost + $<total>"],
    ];

    for (const [name, newString] of cases) {
      it(`does not interpret ${name}`, async () => {
        writeFileSync(join(workspace, "money.ts"), "const price = 10;\n");
        await read({ path: "money.ts" });

        await edit({ path: "money.ts", oldString: "10", newString });

        expect(await read({ path: "money.ts" })).toContain(`const price = ${newString};`);
      });

      it(`does not interpret ${name} under replaceAll`, async () => {
        writeFileSync(join(workspace, "money.ts"), "a = 10;\nb = 10;\n");
        await read({ path: "money.ts" });

        await edit({ path: "money.ts", oldString: "10", newString, replaceAll: true });

        const after = await read({ path: "money.ts" });
        expect(after).toContain(`a = ${newString};`);
        expect(after).toContain(`b = ${newString};`);
      });
    }

    it("keeps a shell variable in a script intact", async () => {
      // The realistic version: nothing here looks like a regular expression to
      // a person, and two of these tokens are substitution patterns.
      writeFileSync(join(workspace, "run.sh"), "echo old\n");
      await read({ path: "run.sh" });

      await edit({
        path: "run.sh",
        oldString: "echo old",
        newString: 'echo "$@ ${HOME} $$ $1"',
      });

      expect(await read({ path: "run.sh" })).toContain('echo "$@ ${HOME} $$ $1"');
    });
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
    standalone.record(SCOPE, "C:/x/a.ts", { modifiedAt: 1, size: 1 });
    standalone.forget(SCOPE.conversationId);

    expect(standalone.get(SCOPE, "C:/x/a.ts")).toBeUndefined();
  });

  it("does not confuse two conversations whose ids and paths overlap", () => {
    // With a space between the two halves, conversation "a" with path "b c"
    // and conversation "a b" with path "c" were one key — and keeping one
    // conversation's reads away from another's is the whole job.
    const standalone = new FileAccessLog();
    const first = { ...SCOPE, conversationId: "a" };
    const second = { ...SCOPE, conversationId: "a b" };

    standalone.record(first, "b c", { modifiedAt: 1, size: 1 });

    expect(standalone.get(first, "b c")?.modifiedAt).toBe(1);
    expect(standalone.get(second, "c")).toBeUndefined();
  });

  it("forgets only the conversation it was asked about", () => {
    const standalone = new FileAccessLog();
    const first = { ...SCOPE, conversationId: "a" };
    const second = { ...SCOPE, conversationId: "a b" };

    standalone.record(first, "x.ts", { modifiedAt: 1, size: 1 });
    standalone.record(second, "x.ts", { modifiedAt: 2, size: 2 });
    standalone.forget("a");

    expect(standalone.get(first, "x.ts")).toBeUndefined();
    // A space-prefixed match would have swept this away too.
    expect(standalone.get(second, "x.ts")?.modifiedAt).toBe(2);
  });
});

describe("a window past the end of the file says so", () => {
  it("names the offset and the length rather than returning nothing", () => {
    // The empty string was indistinguishable from an empty file and from a
    // failed read, so the model answered as though the file held nothing.
    const output = formatNumbered("one\ntwo\n", 50, 100);

    expect(output).toContain("offset 50");
    expect(output).toContain("2 lines");
  });

  it("counts one line in the singular", () => {
    expect(formatNumbered("only\n", 9, 10)).toContain("1 line)");
  });
});

describe("a file's own line endings survive an edit", () => {
  it("matches text copied out of a read against a CRLF file", async () => {
    // `read` shows lines without their carriage returns, so a model copying
    // two of them back sends "\n" where the file holds "\r\n". Before this,
    // every multi-line edit of a Windows file failed to match.
    writeFileSync(join(workspace, "crlf.ts"), "const a = 1;\r\nconst b = 2;\r\n");
    await read({ path: "crlf.ts" });

    await edit({
      path: "crlf.ts",
      oldString: "const a = 1;\nconst b = 2;",
      newString: "const a = 9;\nconst b = 8;",
    });

    const after = readFileSync(join(workspace, "crlf.ts"), "utf8");
    expect(after).toBe("const a = 9;\r\nconst b = 8;\r\n");
  });

  it("leaves an LF file alone", async () => {
    await read({ path: "src/app.ts" });
    await edit({
      path: "src/app.ts",
      oldString: "const a = 1;\nconst b = 2;",
      newString: "const a = 9;",
    });

    expect(readFileSync(join(workspace, "src", "app.ts"), "utf8")).toBe("const a = 9;\n");
  });
});

describe("two writers to one file", () => {
  it("does not lose one of two edits issued together", async () => {
    // Each edit is a read, a computation, and a write across several awaits.
    // Interleaved, both read the same content and the second overwrote the
    // first - while both reported success. Serialized per path, the second
    // reads what the first wrote.
    await read({ path: "src/app.ts" });

    await Promise.all([
      edit({ path: "src/app.ts", oldString: "const a = 1;", newString: "const a = 9;" }),
      edit({ path: "src/app.ts", oldString: "const b = 2;", newString: "const b = 8;" }),
    ]);

    const after = readFileSync(join(workspace, "src", "app.ts"), "utf8");
    expect(after).toContain("const a = 9;");
    expect(after).toContain("const b = 8;");
  });
});

describe("what counts as the file having changed", () => {
  it("catches a rewrite that kept the modification time", () => {
    // FAT, exFAT and network shares keep timestamps to a second or two, and
    // some writers restore them outright. A different size is proof of a
    // different file and costs nothing - the stat was already taken.
    const log = new FileAccessLog();
    log.record(SCOPE, "C:/x/a.ts", { modifiedAt: 10, size: 100 });

    expect(() =>
      log.assertSafeToModify(SCOPE, "C:/x/a.ts", {
        exists: true,
        modifiedAt: 10,
        size: 120,
      }),
    ).toThrow(ToolError);
  });

  it("believes the content over the timestamp when both are known", () => {
    const log = new FileAccessLog();
    log.record(SCOPE, "C:/x/a.ts", { modifiedAt: 10, size: 100, contentHash: "abc" });

    // Same bytes, later timestamp: a formatter that rewrote the file
    // identically has changed nothing the model needs to re-read.
    expect(() =>
      log.assertSafeToModify(SCOPE, "C:/x/a.ts", {
        exists: true,
        modifiedAt: 99,
        size: 100,
        contentHash: "abc",
      }),
    ).not.toThrow();

    // Different bytes, unchanged timestamp: changed, whatever the clock says.
    expect(() =>
      log.assertSafeToModify(SCOPE, "C:/x/a.ts", {
        exists: true,
        modifiedAt: 10,
        size: 100,
        contentHash: "def",
      }),
    ).toThrow(ToolError);
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
