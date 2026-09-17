import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import type { Interpreter } from "../../../src/process/interpreter.js";
import type { ProcessResult, RunProcessOptions } from "../../../src/process/exec.js";
import type { IsolationSupport } from "../../../src/sandbox/isolation/backend.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { CallGate } from "../../../src/tools/gate.js";
import { BackgroundJobs } from "../../../src/process/background.js";
import { demotionNote } from "../../../src/tools/shell/index.js";

/**
 * The demotion the model is told about.
 *
 * The shell tool is registered under the interpreter the machine resolved
 * first, so when that interpreter dies unstarted and the process moves to
 * the next one, the description the model has already read names the wrong
 * shell. The note below is the one place the new interpreter is stated.
 *
 * Hermetic on purpose: the interpreter module is faked per test (two shells,
 * the first dying, the second carrying everything), and the spawn point
 * answers from a script this file owns. Nothing here needs containment, a
 * real shell, or the machine's interpreter order - the file that owns those
 * is `shell.test.ts`.
 */

const DYING_LOADER = "*** fatal error - the test loader died";

const scripted: ProcessResult[] = [];

vi.mock("../../../src/process/exec.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/process/exec.js")>();
  return {
    ...original,
    runProcess: async (options: RunProcessOptions) => scripted.shift() ?? original.runProcess(options),
  };
});

/** Two shells with the production shape: a POSIX first, a cmd second. */
function fakeShells() {
  const bashPath =
    process.platform === "win32" ? "C:\\fake\\bash.exe" : "/fake/bash";
  const cmdPath = process.platform === "win32" ? "C:\\fake\\cmd.exe" : "/fake/cmd";
  const fakeBash: Interpreter = {
    path: bashPath,
    label: "bash",
    kind: "bash",
    args: ["-c"],
    takes: "argv",
    separators: [";", "&", "&&", "||"],
    statement: ["Commands run through bash."],
  };
  const fakeCmd: Interpreter = {
    path: cmdPath,
    label: "cmd",
    kind: "cmd",
    args: ["/d", "/s", "/c"],
    takes: "command-line",
    separators: ["&", "&&", "||"],
    statement: ["Commands run through cmd.exe."],
  };
  let chosen = 0;
  const started = new Set<string>();
  const list = [fakeBash, fakeCmd];
  return {
    resolveInterpreter: () => list[chosen],
    demoteInterpreter: (failed: Interpreter) => {
      if (list[chosen] !== failed) return true;
      if (chosen + 1 >= list.length) return false;
      chosen += 1;
      return true;
    },
    markInterpreterStarted: (interpreter: Interpreter) => {
      started.add(interpreter.path);
    },
    interpreterStarted: (interpreter: Interpreter) => started.has(interpreter.path),
  };
}

async function shellWithFakeShells() {
  vi.resetModules();
  vi.doMock("../../../src/process/interpreter.js", () => fakeShells());
  const shell = await import("../../../src/tools/shell/index.js");
  const interpreter = await import("../../../src/process/interpreter.js");
  return { shell, interpreter };
}

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

const NODEQ = `"${process.execPath}"`;

let db: StudioDatabase;
let workspace: string;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-shell-demotion-"));
});

afterEach(() => {
  db.close();
  scripted.length = 0;
  vi.doUnmock("../../../src/process/interpreter.js");
  rmSync(workspace, { recursive: true, force: true });
});

/** A sandbox whose containment is a pass-through: no backend, no grants, no machine. */
function passThroughSandbox() {
  const support: IsolationSupport = {
    level: "os",
    backend: undefined,
    enforcing: true,
    shortfall: [],
  };
  return new LocalSandbox(
    createSandboxPolicy({
      workspaceRoot: workspace,
      environment: {
        PATH: process.env.PATH ?? "",
        ...(process.env.PATHEXT === undefined ? {} : { PATHEXT: process.env.PATHEXT }),
      },
    }),
    support,
  );
}

function gateWith(
  register: (instance: CallGate) => void,
  sandbox: LocalSandbox,
): CallGate {
  const instance = new CallGate({
    kernel: new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver: {
        request: async () => ({ verdict: "allow" as const, duration: "once" as const }),
      },
    }),
    sandbox,
  });
  register(instance);
  return instance;
}

describe("the note a demotion carries", () => {
  it("names the shell that died, in its own words, and the one the session uses now", () => {
    const from: Interpreter = {
      path: "C:\\fake\\bash.exe",
      label: "bash",
      kind: "bash",
      args: ["-c"],
      takes: "argv",
      separators: [";", "&", "&&", "||"],
      statement: ["Commands run through bash."],
    };
    const to: Interpreter = {
      path: "C:\\fake\\cmd.exe",
      label: "cmd",
      kind: "cmd",
      args: ["/d", "/s", "/c"],
      takes: "command-line",
      separators: ["&", "&&", "||"],
      statement: ["Commands run through cmd.exe."],
    };
    const note = demotionNote(from, to, DYING_LOADER);
    expect(note).toContain("bash");
    expect(note).toContain(DYING_LOADER);
    expect(note).toContain("3221225794");
    expect(note).toContain("cmd");
    expect(note).toContain("Commands run through cmd.exe.");
  });

  it("names the loader death when the dead shell said nothing", () => {
    const from: Interpreter = {
      path: "C:\\fake\\bash.exe",
      label: "bash",
      kind: "bash",
      args: ["-c"],
      takes: "argv",
      separators: [";", "&", "&&", "||"],
      statement: ["Commands run through bash."],
    };
    const to: Interpreter = {
      path: "C:\\fake\\cmd.exe",
      label: "cmd",
      kind: "cmd",
      args: ["/d", "/s", "/c"],
      takes: "command-line",
      separators: ["&", "&&", "||"],
      statement: ["Commands run through cmd.exe."],
    };
    const note = demotionNote(from, to, undefined);
    expect(note).toContain("bash");
    expect(note).toContain("3221225794");
    expect(note).not.toContain('""');
  });

  it("quotes the first line of a longer death, not the whole of it", () => {
    // The dead attempt's stream can run on - a loader, a runtime, a warning -
    // and only its first line is the diagnostic the note exists to carry.
    const from: Interpreter = {
      path: "C:\\fake\\bash.exe",
      label: "bash",
      kind: "bash",
      args: ["-c"],
      takes: "argv",
      separators: [";", "&", "&&", "||"],
      statement: ["Commands run through bash."],
    };
    const to: Interpreter = {
      path: "C:\\fake\\cmd.exe",
      label: "cmd",
      kind: "cmd",
      args: ["/d", "/s", "/c"],
      takes: "command-line",
      separators: ["&", "&&", "||"],
      statement: ["Commands run through cmd.exe."],
    };
    const note = demotionNote(from, to, `\n  ${DYING_LOADER}\nSECOND-LINE-MARKER\n`);
    expect(note).toContain(DYING_LOADER);
    expect(note).not.toContain("SECOND-LINE-MARKER");
  });
});

describe("a demotion through the tool", () => {
  it("reports the retried answer with the note beneath it", async () => {
    // The first spawn dies in its loader with a fatal line, the probe dies
    // the same way, and the retry under the next shell lands.
    scripted.push(
      { exitCode: 3221225794, stdout: "", stderr: DYING_LOADER },
      { exitCode: 3221225794, stdout: "", stderr: DYING_LOADER },
      { exitCode: 0, stdout: "hello from the retry", stderr: "" },
    );
    const { shell, interpreter } = await shellWithFakeShells();
    const before = interpreter.resolveInterpreter();
    expect(before?.label).toBe("bash");

    const instance = gateWith(
      (gate) => shell.registerShellTools(gate),
      passThroughSandbox(),
    );
    const output = await instance.call({
      name: "native/shell",
      input: { command: `${NODEQ} -e "console.log('hello')"` },
      scope: SCOPE,
    });

    const after = interpreter.resolveInterpreter();
    expect(after?.label).toBe("cmd");
    expect(output).toContain("hello from the retry");
    expect(output).toContain(DYING_LOADER);
    expect(output).toContain("3221225794");
    expect(output).toContain("bash");
    expect(output).toContain("cmd");
    // The command's answer first: the note is news, not the outcome.
    const text = typeof output === "string" ? output : JSON.stringify(output);
    expect(text.indexOf("hello from the retry")).toBeLessThan(text.indexOf("could not be contained"));
    expect(scripted).toHaveLength(0);
  });

  it("proves the interpreter before a background job exists, and says which shell the job runs under", async () => {
    // The probe dies, so the plan is rebuilt under the next shell before the
    // job exists: a background bash that cannot be contained would otherwise
    // die inside the registry, where there is no retry point.
    scripted.push({ exitCode: 3221225794, stdout: "", stderr: DYING_LOADER });
    const { shell, interpreter } = await shellWithFakeShells();
    const jobs = new BackgroundJobs();
    try {
      const instance = gateWith(
        (gate) => shell.registerShellTools(gate, { jobs }),
        passThroughSandbox(),
      );
      const output = await instance.call({
        name: "native/shell",
        input: { command: `${NODEQ} -e "setInterval(() => {}, 1000)"`, background: true },
        scope: SCOPE,
      });

      expect(interpreter.resolveInterpreter()?.label).toBe("cmd");
      expect(jobs.list(SCOPE.conversationId)).toHaveLength(1);
      expect(output).toContain("in the background");
      expect(output).toContain("could not be contained");
      expect(output).toContain("bash");
      expect(output).toContain("cmd");
      expect(scripted).toHaveLength(0);
      // The plan points at a shell that exists only in the fakes above, so
      // the start fails at once; wait out that failure before stopping, or
      // the stop kills a child that was never born.
      const id = jobs.list(SCOPE.conversationId)[0]?.id ?? "";
      for (
        let attempt = 0;
        attempt < 50 && jobs.get(SCOPE.conversationId, id)?.state === "running";
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(jobs.get(SCOPE.conversationId, id)?.state).toBe("failed");
    } finally {
      jobs.stopAll();
    }
  });
});
