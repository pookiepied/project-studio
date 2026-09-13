import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
import { GREP_DESCRIPTOR } from "../../../src/tools/search/grep.js";
import {
  DEFAULT_EXCLUDES,
  buildFilesArgs,
  buildSearchArgs,
  formatCounts,
  formatMatches,
  parseMatches,
  registerSearchTools,
  toRelative,
} from "../../../src/tools/search/index.js";
import { resolveBinary } from "../../../src/vendor/resolver.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

/** ripgrep is not vendored yet, so the end-to-end tests run only where it is. */
const HAS_RIPGREP = (() => {
  try {
    resolveBinary("rg");
    return true;
  } catch {
    return false;
  }
})();

const BASE = {
  pattern: "needle",
  searchPath: "C:/work",
  outputMode: "content" as const,
  glob: undefined,
  type: undefined,
  caseInsensitive: false,
  multiline: false,
  contextBefore: 0,
  contextAfter: 0,
  includeIgnored: false,
};

describe("the argument vector is built, never supplied", () => {
  it("passes the pattern as a value, so one starting with a dash is not a flag", () => {
    // A flag ripgrep really has, and one this builder never passes itself -
    // the assertion below is that the pattern did not become a flag, so it
    // must not be a flag the vector legitimately contains for its own reasons.
    // `--hidden` used to serve here and no longer can: every search passes it
    // now, so its presence would prove nothing.
    const args = buildSearchArgs({ ...BASE, pattern: "--files" });

    // `--regexp=<pattern>`: everything after the equals sign is the value, so
    // there is nothing left for ripgrep's parser to interpret.
    expect(args).toContain("--regexp=--files");
    expect(args).not.toContain("--files");
  });

  it("separates the path with --, so a path is never read as a flag", () => {
    const args = buildSearchArgs(BASE);

    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe("C:/work");
  });

  it("cannot produce the flags that would make ripgrep run a command", () => {
    // `--pre` and `--hostname-bin` turn ripgrep into arbitrary execution. If
    // either can be reached from input, search stops being a read capability.
    const hostile = buildSearchArgs({
      ...BASE,
      pattern: "--pre=sh",
      glob: "--hostname-bin=sh",
      type: "--pre",
    });

    expect(hostile).not.toContain("--pre");
    expect(hostile).not.toContain("--hostname-bin");
  });

  it("chooses the output format per mode", () => {
    expect(buildSearchArgs({ ...BASE, outputMode: "files" })).toContain(
      "--files-with-matches",
    );
    expect(buildSearchArgs({ ...BASE, outputMode: "count" })).toContain("--count-matches");
    // JSON, because a Windows path contains a colon and `path:line:text` cannot
    // be parsed unambiguously.
    expect(buildSearchArgs({ ...BASE, outputMode: "content" })).toContain("--json");
  });

  it("excludes dependency directories unless asked", () => {
    const args = buildSearchArgs(BASE);
    for (const exclude of DEFAULT_EXCLUDES) expect(args).toContain(`--glob=${exclude}`);

    const everything = buildSearchArgs({ ...BASE, includeIgnored: true });
    expect(everything).toContain("--no-ignore");
    expect(everything).toContain("--hidden");
    expect(everything).not.toContain("--glob=!node_modules");
  });

  it("looks at dotfiles without also looking in ignored directories", () => {
    // `.env.example`, `.github/workflows/*` and `.eslintrc` are ordinary parts
    // of a project. They used to be reachable only by also passing
    // `--no-ignore`, which drags `node_modules` back in, so "No files matched"
    // was the answer for a file sitting right there.
    const args = buildSearchArgs(BASE);

    expect(args).toContain("--hidden");
    expect(args).not.toContain("--no-ignore");
    // Making dotfiles visible must not mean walking the object store.
    expect(args).toContain("--glob=!.git");

    const files = buildFilesArgs({
      pattern: "**/*",
      searchPath: "C:/work",
      includeIgnored: false,
    });
    expect(files).toContain("--hidden");
    expect(files).not.toContain("--no-ignore");
  });

  it("passes filters through", () => {
    const args = buildSearchArgs({ ...BASE, glob: "*.ts", type: "rust", caseInsensitive: true });

    expect(args).toContain("--glob=*.ts");
    expect(args).toContain("--type=rust");
    expect(args).toContain("--ignore-case");
  });

  it("only applies context in content mode", () => {
    // Context lines have no meaning in a file list or a count.
    expect(buildSearchArgs({ ...BASE, contextBefore: 2 })).toContain("--before-context=2");
    expect(
      buildSearchArgs({ ...BASE, outputMode: "files", contextBefore: 2 }),
    ).not.toContain("--before-context=2");
  });

  it("lists files by name pattern", () => {
    const args = buildFilesArgs({
      pattern: "**/*.ts",
      searchPath: "C:/work",
      includeIgnored: false,
    });

    expect(args).toContain("--files");
    expect(args).toContain("--glob=**/*.ts");
    expect(args.at(-1)).toBe("C:/work");
  });
});

describe("reading ripgrep's output", () => {
  const stream = [
    JSON.stringify({ type: "begin", data: { path: { text: "C:/work/a.ts" } } }),
    JSON.stringify({
      type: "match",
      data: { path: { text: "C:/work/a.ts" }, lines: { text: "found it\n" }, line_number: 3 },
    }),
    JSON.stringify({
      type: "context",
      data: { path: { text: "C:/work/a.ts" }, lines: { text: "nearby\n" }, line_number: 4 },
    }),
    JSON.stringify({ type: "summary", data: {} }),
  ].join("\n");

  it("keeps matches and context, and drops the rest", () => {
    const matches = parseMatches(stream);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ lineNumber: 3, text: "found it", isMatch: true });
    expect(matches[1]).toMatchObject({ lineNumber: 4, text: "nearby", isMatch: false });
  });

  it("skips a record whose path is not valid text", () => {
    // A filename we cannot represent is one we cannot hand back to be read.
    const bytes = JSON.stringify({
      type: "match",
      data: { path: { bytes: "3q2+7w==" }, lines: { text: "x\n" }, line_number: 1 },
    });

    expect(parseMatches(bytes)).toHaveLength(0);
  });

  it("survives a malformed line rather than failing the whole search", () => {
    expect(parseMatches(`not json\n${stream}`)).toHaveLength(2);
  });

  it("marks matches and context differently", () => {
    // Without the distinction, surrounding lines read as additional hits.
    const output = formatMatches("C:/work", parseMatches(stream));

    expect(output).toContain("     3: found it");
    expect(output).toContain("     4- nearby");
    expect(output.split("\n")[0]).toBe("a.ts");
  });

  it("truncates a line too long to be worth returning", () => {
    const long = JSON.stringify({
      type: "match",
      data: { path: { text: "C:/work/a.ts" }, lines: { text: `${"x".repeat(2_000)}\n` }, line_number: 1 },
    });

    expect(formatMatches("C:/work", parseMatches(long))).toContain("[line truncated]");
  });

  it("splits counts on the last colon, not the first", () => {
    // A Windows path contains a colon of its own.
    const output = formatCounts("C:/work", "C:/work/src/a.ts:4\nC:/work/b.ts:1", 10, 0);

    expect(output).toBe("src/a.ts: 4\nb.ts: 1");
  });

  it("pages counts", () => {
    const output = formatCounts("C:/work", "C:/work/a.ts:1\nC:/work/b.ts:2\nC:/work/c.ts:3", 1, 1);

    expect(output).toBe("b.ts: 2");
  });

  it("reports paths relative to the project", () => {
    expect(toRelative("C:/work", "C:/work/src/a.ts")).toBe("src/a.ts");
  });
});

describe("the tools themselves", () => {
  let db: StudioDatabase;
  let workspace: string;
  let gate: CallGate;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    workspace = mkdtempSync(join(tmpdir(), "studio-search-"));
    mkdirSync(join(workspace, "src"), { recursive: true });
    mkdirSync(join(workspace, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(workspace, "src", "app.ts"), "const needle = 1;\nconst other = 2;\n");
    writeFileSync(join(workspace, "src", "util.js"), "// needle here\n");
    writeFileSync(join(workspace, "node_modules", "pkg", "index.js"), "needle in a haystack\n");

    gate = new CallGate({
      kernel: new PermissionKernel({ grants: new PermissionGrantStore(db) }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
    });
    registerSearchTools(gate);
  });

  afterEach(() => {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  const grep = (input: unknown) =>
    gate.call({ name: "native/grep", input, scope: SCOPE }) as Promise<string>;
  const glob = (input: unknown) =>
    gate.call({ name: "native/glob", input, scope: SCOPE }) as Promise<string>;

  it("declares both as read-only, despite running a program", () => {
    // The whole substrate argument: a fixed argument vector over a known binary
    // is not arbitrary execution, so these stay `read` and work in the
    // in-process sandbox.
    const effects = new Map(gate.list().map((tool) => [tool.id.name, tool.effects]));

    expect(effects.get("grep")).toEqual(["read"]);
    expect(effects.get("glob")).toEqual(["read"]);
  });

  it("requires a pattern", async () => {
    await expect(grep({})).rejects.toThrow(/pattern is required/i);
    await expect(glob({})).rejects.toThrow(/pattern is required/i);
  });

  it("rejects an unknown output mode", async () => {
    await expect(grep({ pattern: "x", outputMode: "everything" })).rejects.toThrow(
      ToolError,
    );
  });

  it("bounds the filters it accepts", async () => {
    await expect(grep({ pattern: "x", contextBefore: 500 })).rejects.toThrow(/between 0 and 10/i);
    await expect(grep({ pattern: "x", limit: 0 })).rejects.toThrow(/between 1 and 1000/i);
  });

  it("refuses to search outside the workspace", async () => {
    await expect(grep({ pattern: "x", path: "../.." })).rejects.toThrow(SandboxError);
    await expect(glob({ pattern: "*", path: "../.." })).rejects.toThrow(SandboxError);
  });

  it.runIf(HAS_RIPGREP)("finds matching files and skips dependencies", async () => {
    const output = await grep({ pattern: "needle" });

    expect(output).toContain("src/app.ts");
    expect(output).toContain("src/util.js");
    expect(output).not.toContain("node_modules");
  });

  it.runIf(HAS_RIPGREP)("searches dependencies when asked", async () => {
    expect(await grep({ pattern: "needle", includeIgnored: true })).toContain("node_modules");
  });

  it.runIf(HAS_RIPGREP)("returns lines in content mode", async () => {
    const output = await grep({ pattern: "needle", outputMode: "content" });

    expect(output).toContain("     1: const needle = 1;");
  });

  it.runIf(HAS_RIPGREP)("filters by file glob", async () => {
    const output = await grep({ pattern: "needle", glob: "*.ts" });

    expect(output).toContain("src/app.ts");
    expect(output).not.toContain("util.js");
  });

  it.runIf(HAS_RIPGREP)("says nothing was found, and why it might not have been", async () => {
    // A silent empty result reads as "this does not exist in the project",
    // which is not what an ignored directory means.
    expect(await grep({ pattern: "zzzz" })).toMatch(/no matches.*node_modules/is);
  });

  it.runIf(HAS_RIPGREP)("lists a directory with glob", async () => {
    const output = await glob({ pattern: "src/*" });

    expect(output).toContain("src/app.ts");
    expect(output).toContain("src/util.js");
  });

  it.runIf(HAS_RIPGREP)("matches by extension across the tree", async () => {
    expect(await glob({ pattern: "**/*.ts" })).toContain("src/app.ts");
  });

  it.runIf(HAS_RIPGREP)("orders by modification time, newest first", async () => {
    const older = join(workspace, "src", "older.ts");
    const newer = join(workspace, "src", "newer.ts");
    writeFileSync(older, "");
    writeFileSync(newer, "");
    // Set explicitly rather than written in order: two writes in the same
    // millisecond would make the assertion pass or fail by timing.
    utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    utimesSync(newer, new Date(2_000_000), new Date(2_000_000));

    const output = await glob({ pattern: "src/*.ts" });

    expect(output.indexOf("newer.ts")).toBeLessThan(output.indexOf("older.ts"));
  });

  it.runIf(HAS_RIPGREP)("says so when it sorts by name instead", async () => {
    // The description promises "most recently modified first". Above the
    // ceiling it sorts by name, and a result that silently means something else
    // is a lie the model cannot detect.
    const many = join(workspace, "many");
    mkdirSync(many, { recursive: true });
    for (let index = 0; index <= 1_000; index += 1) {
      writeFileSync(join(many, `file-${String(index).padStart(5, "0")}.ts`), "");
    }

    const output = await glob({ pattern: "many/*.ts", limit: 5 });

    expect(output).toMatch(/sorted by name/i);
    expect(output).toContain("file-00000.ts");
  });

  it.runIf(HAS_RIPGREP)("stays quiet about ordering when it kept its promise", async () => {
    expect(await glob({ pattern: "src/*" })).not.toMatch(/sorted by name/i);
  });

  it.runIf(HAS_RIPGREP)("returns file paths when the mode is left out", async () => {
    // The declared default, exercised rather than read: no `outputMode`, so
    // no matching lines - just the files that hold them.
    const output = await grep({ pattern: "needle" });

    expect(output).toContain("src/app.ts");
    expect(output).not.toContain("const needle = 1;");
  });
});

/**
 * The default a model is told about, against the default it actually gets.
 *
 * `outputMode` is the one grep parameter whose default changes the kind of
 * answer rather than how much of it: ask for lines without setting it and a
 * list of file paths comes back, which reads as the tool ignoring the request.
 * It is stated twice for that reason - in the description and in the schema,
 * where the argument is being written - and two statements of one fact can
 * disagree.
 *
 * This is the test that stops them. If the parser's fallback is ever changed
 * without the schema, the model is being told something untrue at exactly the
 * moment it is deciding what to send.
 */
describe("grep's declared default", () => {
  it("declares the mode it actually falls back to", () => {
    const properties = (GREP_DESCRIPTOR.inputSchema as {
      properties: { outputMode: { default?: unknown } };
    }).properties;

    expect(properties.outputMode.default).toBe("files");
  });

  it("says in its description what the default is", () => {
    // The schema is not the only place a model reads. A default declared in
    // one and contradicted in the other is worse than declaring neither.
    expect(GREP_DESCRIPTOR.description).toContain("file paths by default");
  });
});
