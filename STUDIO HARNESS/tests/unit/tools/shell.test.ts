import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { requiresUndoPoint } from "../../../src/contracts/effects.js";
import {
  interpreterStarted,
  markInterpreterStarted,
  resolveInterpreter,
  type CommandSeparator,
  type Interpreter,
  type InterpreterKind,
} from "../../../src/process/interpreter.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import type { PermissionRequest } from "../../../src/permissions/policy.js";
import { SandboxError } from "../../../src/sandbox/errors.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { ToolError } from "../../../src/tools/errors.js";
import { CallGate } from "../../../src/tools/gate.js";
import { BackgroundJobs } from "../../../src/process/background.js";
import { readCommandPrograms } from "../../../src/tools/shell/command.js";
import {
  interpreterCanStart,
  registerShellTools,
  shellResource,
  SHELL_DESCRIPTOR,
} from "../../../src/tools/shell/index.js";
import { CAN_CONTAIN, itContained } from "../../contained.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

/** node is the one program guaranteed to exist wherever these tests run. */
const NODE = process.execPath;
/** Quoted for the interpreter, since an absolute path may contain spaces. */
const NODEQ = `"${NODE}"`;

/** True when npm sits somewhere on this machine's program path. */
function npmOnPath(): boolean {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (directory === "") continue;
    for (const name of process.platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"]) {
      try {
        if (statSync(join(directory, name)).isFile()) return true;
      } catch {
        // Not in this directory.
      }
    }
  }
  return false;
}

/** Runs only where containment works and npm is installed: the shim proof. */
const itRunsNpm = CAN_CONTAIN && npmOnPath() ? itContained : it.skip;

let db: StudioDatabase;
let workspace: string;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  workspace = mkdtempSync(join(tmpdir(), "studio-shell-"));
});

afterEach(() => {
  db.close();
  removeWorkspace(workspace);
});

/**
 * Removes the temporary workspace, waiting out a process that still holds it.
 *
 * A background job is killed by signalling its tree, and on Windows the
 * directory it had as its `cwd` stays locked for a short while after the last
 * process in that tree is gone - so a removal issued immediately fails with
 * EPERM even though nothing is running any more. Retrying briefly is the fix;
 * the alternative seen here was a suite that passed except when the machine
 * was busy.
 */
function removeWorkspace(directory: string): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch {
      // Busy-wait rather than await: this runs in a synchronous teardown, and
      // the wait is tens of milliseconds at worst.
      const until = Date.now() + 50;
      while (Date.now() < until) {
        /* hold */
      }
    }
  }
  // Last attempt, and this one is allowed to throw: a directory that is still
  // locked after a second is a process we failed to kill, which is worth
  // failing the suite over.
  rmSync(directory, { recursive: true, force: true });
}

/** What the kernel was asked about, in order. */
function recordingApprover() {
  const asked: (string | undefined)[] = [];
  return {
    asked,
    request: async (request: PermissionRequest) => {
      asked.push(request.resource);
      return { verdict: "allow" as const, duration: "once" as const };
    },
  };
}

function gate(options: { allowExec?: boolean; approver?: ReturnType<typeof recordingApprover>; jobs?: BackgroundJobs } = {}) {
  const sandbox = new LocalSandbox(
    createSandboxPolicy({
      workspaceRoot: workspace,
      allowExec: options.allowExec ?? true,
      // The same grant the runtime makes: a shell's job is finding programs,
      // and the approval names them instead of their resolved paths. PATHEXT
      // rides with it, because without it Windows never tries `node.exe`.
      environment: {
        PATH: process.env.PATH ?? "",
        ...(process.env.PATHEXT === undefined ? {} : { PATHEXT: process.env.PATHEXT }),
      },
    }),
  );
  const instance = new CallGate({
    kernel: new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver:
        options.approver ??
        { request: async () => ({ verdict: "allow" as const, duration: "once" as const }) },
    }),
    sandbox,
  });
  registerShellTools(instance, options.jobs === undefined ? {} : { jobs: options.jobs });
  return instance;
}

function run(instance: CallGate, input: unknown) {
  return instance.call({ name: "native/shell", input, scope: SCOPE });
}

describe("how long a command may run", () => {
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

describe("running a command line", () => {
  // `itContained` on everything that actually starts one. The shell tool is
  // owed `os` isolation, so on a host that cannot supply it the call is
  // refused - correctly, and that refusal is asserted in the sandbox
  // integration suites. What is *not* gated is everything decided before the
  // spawn: an unparsable line, a working directory outside the project, a
  // policy that never opted in. Those hold on every machine.
  itContained("runs it and returns its output", async () => {
    const output = await run(gate(), {
      command: `${NODEQ} -e "console.log('hello')"`,
    });

    expect(output).toContain("hello");
  });

  itContained("reports a non-zero exit as a result rather than a failure", async () => {
    // A failing test suite is the answer to the question that was asked.
    const output = await run(gate(), {
      command: `${NODEQ} -e "process.exit(3)"`,
    });

    expect(output).toContain("exit code 3");
  });

  itContained("labels stderr so the model can tell the streams apart", async () => {
    const output = await run(gate(), {
      command: `${NODEQ} -e "console.error('bad')"`,
    });

    expect(output).toContain("[stderr]");
    expect(output).toContain("bad");
  });

  itContained("runs in the project, and in a subdirectory when asked", async () => {
    mkdirSync(join(workspace, "sub"), { recursive: true });

    const output = await run(gate(), {
      command: `${NODEQ} -e "console.log(process.cwd())"`,
      cwd: "sub",
    });

    expect(output).toContain("sub");
  });

  it("refuses a working directory outside the project", async () => {
    await expect(
      run(gate(), { command: `${NODEQ} -e "0"`, cwd: "../.." }),
    ).rejects.toBeInstanceOf(SandboxError);
  });

  it("names the working directory it could not find", async () => {
    // This used to surface as "The command could not be started in cmd." - a
    // sentence with no subject. It cost an evaluation run two false diagnoses
    // (the cwd parameter is broken; a directory is invisible) when the real
    // cause was a typo in the directory name.
    await expect(
      run(gate(), { command: `${NODEQ} -e "0"`, cwd: "msite" }),
    ).rejects.toThrow(/does not exist/i);
    await expect(
      run(gate(), { command: `${NODEQ} -e "0"`, cwd: "msite" }),
    ).rejects.toThrow(/msite/);
  });

  itContained("stops a command that outlives its time limit", async () => {
    const output = await run(gate(), {
      command: `${NODEQ} -e "setInterval(() => {}, 1000)"`,
      timeoutMs: 1_000,
    });

    expect(output).toMatch(/still running.*stopped/i);
  });
});

describe("the interpreter runs the line", () => {
  // The properties pipes and chaining rest on. Where the chosen interpreter
  // is PowerShell 5.1, `&&` is unavailable to the *shell*, not to the reader -
  // the environment block says so, and the model writes `;` instead.
  itContained("interprets redirection", async () => {
    const output = await run(gate(), {
      command: `${NODEQ} -e "console.log('into the file')" > out.txt`,
    });

    expect(output).not.toContain("into the file");
    expect(statSync(join(workspace, "out.txt")).size).toBeGreaterThan(0);
  });

  itContained("interprets a pipe between two programs", async () => {
    // Both sides are node, so the test does not depend on which other tools
    // the machine ships - only on the interpreter `resolveInterpreter` picked.
    const output = await run(gate(), {
      command: `node -e "process.stdout.write('hello')" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(d.trim().toUpperCase()))"`,
    });

    expect(output).toContain("HELLO");
  });

  itRunsNpm("runs an npm shim, which the old tool refused outright", async () => {
    // npm is a .cmd shim on Windows: `resolveProgram` refused it by name, and
    // this one result is the whole reason the tool takes a command line now.
    const output = await run(gate(), { command: "npm --version" });

    expect(output).toMatch(/(^|\n)\d+\.\d+\.\d+/);
  });
});

describe("the interpreter is chosen once, by the machine", () => {
  it("resolves to a real absolute executable whose statement the model can read", () => {
    const interpreter = resolveInterpreter();

    // Every machine this suite runs on has some shell: /bin/sh on POSIX,
    // powershell or cmd on Windows. Undefined here would mean the shell tool
    // refuses everywhere, which the environment-block test would also catch.
    expect(interpreter).toBeDefined();
    expect(isAbsolute(interpreter?.path ?? "/")).toBe(true);
    expect(statSync(interpreter?.path ?? "/").isFile()).toBe(true);
    expect(interpreter?.statement.join(" ")).toMatch(/Commands run through/);
  });

  it("declares how it reads a line, and only cmd reads a command line", () => {
    // The join is per interpreter and it is not a preference: a PowerShell
    // host given the cmd join loses the quotes inside its own -Command, and
    // a cmd given the argv join reads the escaped quotes as data, which is
    // how a fully-qualified path became `'\"C:\Program Files\...\"' is not
    // recognized` on every contained line this machine ran.
    const interpreter = resolveInterpreter();
    expect(interpreter?.takes).toBe(interpreter?.kind === "cmd" ? "command-line" : "argv");
  });
});

describe("whose loader failed", () => {
  it("does not demote an interpreter that has already started something", () => {
    // The bug this replaces. `STATUS_DLL_INIT_FAILED` arrives as the
    // interpreter's exit code, but an interpreter reports its child's exit
    // code as its own - and on this machine `tar --version` under cmd exits
    // with exactly it. Read as a broken cmd, that demoted the whole process,
    // permanently, to Windows PowerShell 5.1, where npm, npx and pnpm are all
    // refused by the execution policy. One `tar` cost every later command in
    // the harness its package manager.
    // A shell this process has never run, so the answer cannot depend on what
    // an earlier test in this file happened to execute.
    const unproven: Interpreter = { ...POWERSHELL_LIKE, path: "/nowhere/unproven" };

    expect(interpreterStarted(unproven)).toBe(false);
    markInterpreterStarted(unproven);
    expect(interpreterStarted(unproven)).toBe(true);
  });

  it("treats a command that ran and failed as the shell having started", () => {
    // A shell that runs a program and reports exit 3 started perfectly well,
    // so what is recorded is "it ran", not "it worked". Asserted on the
    // vocabulary rather than through the gate, because the flag is module
    // state shared with every other test in this file and an assertion about
    // its value after a call would pass for the wrong reason.
    const ran: Interpreter = { ...POWERSHELL_LIKE, path: "/nowhere/ran-and-failed" };
    markInterpreterStarted(ran);
    expect(interpreterStarted(ran)).toBe(true);
  });

  itContained("asks the shell itself, and gets a straight answer", async () => {
    // The probe that decides a demotion when the interpreter has never run
    // anything. `exit 0` reaches no program in any of these shells, so the
    // only thing that can fail it is the shell's own loader - which is the
    // question being asked. Without this the probe is unreachable in this
    // suite, because an earlier test has already proved the interpreter and
    // the fast path skips it.
    const interpreter = resolveInterpreter();
    if (interpreter === undefined) return;
    const sandbox = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: workspace,
        environment: {
          PATH: process.env.PATH ?? "",
          ...(process.env.PATHEXT === undefined ? {} : { PATHEXT: process.env.PATHEXT }),
        },
      }),
    );

    expect(await interpreterCanStart(sandbox, interpreter, workspace)).toBe(true);
  });

  it("keeps the interpreter when a child exits with the loader status", async () => {
    // The regression, end to end through the tool. 0xC0000142 is written as
    // its signed form because that is what `process.exit` takes; Windows
    // reports it back unsigned, which is the value the tool compares.
    //
    // Before the fix this demoted the process permanently. `resolveInterpreter`
    // is module state shared by every conversation in the harness, so the
    // assertion is simply that it is the same interpreter afterwards.
    const before = resolveInterpreter();
    expect(before).toBeDefined();

    await run(gate(), { command: `${NODEQ} -e "process.exit(-1073741502)"` });

    expect(resolveInterpreter()).toBe(before);
  });
});

describe("every program a line names is authorized", () => {
  it("asks once per program, in the order the line names them", async () => {
    const approver = recordingApprover();
    await run(gate({ approver }), {
      command: `${NODEQ} -e "console.log(1)" && definitely-not-a-real-program`,
    });

    expect(approver.asked).toEqual(["shell:node", "shell:definitely-not-a-real-program"]);
  });

  it("runs nothing when one of the named programs is declined", async () => {
    // The name promises more than a rejection, so the allowed half of the line
    // leaves evidence: it writes a file, and the assertion is that the file is
    // not there afterwards. Asserting only that the call rejects would pass
    // just as well against a gate that ran `node`, then hit `curl`, and threw -
    // which is the exact bug the authorize-before-run design exists to prevent
    // and the one this test is named after.
    const witness = join(workspace, "declined-witness.txt");

    const kernel = new PermissionKernel({
      grants: new PermissionGrantStore(db),
      approver: {
        request: async (request) =>
          request.resource === "shell:node"
            ? { verdict: "allow" as const, duration: "once" as const }
            : { verdict: "deny" as const, duration: "once" as const },
      },
    });
    const instance = new CallGate({
      kernel,
      sandbox: new LocalSandbox(
        createSandboxPolicy({
          workspaceRoot: workspace,
          environment: {
            PATH: process.env.PATH ?? "",
            ...(process.env.PATHEXT === undefined ? {} : { PATHEXT: process.env.PATHEXT }),
          },
        }),
      ),
    });
    registerShellTools(instance);

    await expect(
      instance.call({
        name: "native/shell",
        input: {
          command: `${NODEQ} -e "require('fs').writeFileSync(process.argv[1],'ran')" ${JSON.stringify(witness)} && curl example.com`,
        },
        scope: SCOPE,
      }),
    ).rejects.toThrow(/declined/i);

    // The half that was approved still never ran, because the whole line is
    // authorized before any of it starts.
    expect(existsSync(witness)).toBe(false);
  });

  it("checks the programs on both sides of a pipe", async () => {
    const approver = recordingApprover();
    await run(gate({ approver }), {
      command: `${NODEQ} -e "console.log(1)" | ${NODEQ} -e "process.stdin.resume()"`,
    });

    expect(approver.asked).toEqual(["shell:node", "shell:node"]);
  });
});

/**
 * Interpreters the reader is tested against, spelled out rather than resolved.
 *
 * The separator behaviour under test is per interpreter, so a test that used
 * whichever shell the test machine happens to have would assert one row of the
 * table on Windows and a different one in CI, and neither deliberately.
 */
const BASH_LIKE: Interpreter = {
  path: "/bin/bash",
  label: "bash",
  kind: "bash",
  args: ["-c"],
  takes: "argv",
  separators: [";", "&", "&&", "||"],
  statement: ["Commands run through bash."],
};

const CMD_LIKE: Interpreter = {
  path: "C:\\Windows\\System32\\cmd.exe",
  label: "cmd",
  kind: "cmd",
  args: ["/d", "/s", "/c"],
  takes: "command-line",
  separators: ["&", "&&", "||"],
  statement: ["Commands run through cmd.exe."],
};

const POWERSHELL_LIKE: Interpreter = {
  path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  label: "powershell",
  kind: "powershell",
  args: ["-NoProfile", "-NonInteractive", "-Command"],
  takes: "argv",
  separators: [";"],
  statement: ["Commands run through Windows PowerShell 5.1."],
};

describe("the command reader", () => {
  it("names every program a chain runs", () => {
    expect(readCommandPrograms("npm run build && node check.js", BASH_LIKE)).toEqual([
      "npm",
      "node",
    ]);
    expect(readCommandPrograms("a | b | c", BASH_LIKE)).toEqual(["a", "b", "c"]);
    expect(readCommandPrograms("git status; git push", BASH_LIKE)).toEqual(["git", "git"]);
  });

  it("splits on the separators the interpreter honours, and only those", () => {
    // The bug this closes: read with the union of every shell's separators,
    // `git status; git push` named two programs on cmd.exe, which honours no
    // semicolon. The user approved a push that could never run.
    expect(() => readCommandPrograms("git status; git push", CMD_LIKE)).toThrow(/";"/);
    expect(() => readCommandPrograms("git status; git push", CMD_LIKE)).toThrow(/cmd/);

    // Windows PowerShell 5.1 has neither, and a line using them is a syntax
    // error the user must not be asked to approve first.
    expect(() => readCommandPrograms("npm test && npm run build", POWERSHELL_LIKE)).toThrow(
      /"&&"/,
    );
    expect(() => readCommandPrograms("npm test || npm run build", POWERSHELL_LIKE)).toThrow(
      /"\|\|"/,
    );

    // And each honours what it does honour.
    expect(readCommandPrograms("npm test && node check.js", CMD_LIKE)).toEqual(["npm", "node"]);
    expect(readCommandPrograms("git status; git push", POWERSHELL_LIKE)).toEqual(["git", "git"]);
  });

  it("says which separator to write instead", () => {
    // A refusal that does not name the alternative buys another attempt at the
    // same shape.
    expect(() => readCommandPrograms("git status; git push", CMD_LIKE)).toThrow(/&&/);
    expect(() => readCommandPrograms("npm test && npm run build", POWERSHELL_LIKE)).toThrow(/;/);
  });

  it("treats a separator inside quotes as content, never as a split", () => {
    // Quoting is resolved before any separator branch, so a semicolon in an
    // argument is not a cmd refusal and not a second command anywhere.
    expect(readCommandPrograms('node -e "a;b"', CMD_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms("node -e 'a && b'", POWERSHELL_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms('grep "a;b" file', BASH_LIKE)).toEqual(["grep"]);
  });

  it("reads a PowerShell assignment as an assignment, not a program to run", () => {
    // PowerShell writes an assignment as three tokens - `$name`, `=`, value -
    // so the `FOO=1` shape never appears and the head of one was being read as
    // a program named by a variable. An evaluation session was refused
    // `$ProgressPreference = 'SilentlyContinue'; Expand-Archive ...` with
    // "this line runs a program named by the variable $ProgressPreference",
    // which is not what that line does: nothing was named by the variable, the
    // variable was being written to.
    expect(
      readCommandPrograms(
        "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path a.zip -DestinationPath b",
        POWERSHELL_LIKE,
      ),
    ).toEqual(["Expand-Archive"]);

    expect(
      readCommandPrograms("$env:NODE_ENV = 'test'; node build.js", POWERSHELL_LIKE),
    ).toEqual(["node"]);

    // A line that is *only* an assignment still ends with no program, and the
    // existing "a command is required" guard catches it. That is the right
    // answer rather than an oversight: each shell call is its own process, so
    // a variable set and never used dies microseconds later, and a model that
    // wrote one has made a mistake worth being told about. What matters is
    // that it is refused for naming no program, not for naming a bad one.
    expect(() => readCommandPrograms("$count = 5", POWERSHELL_LIKE)).toThrow(
      /command is required/i,
    );
  });

  it("still names the program on the right of an assignment that runs one", () => {
    // The reason the two tokens are stepped over rather than the whole segment
    // skipped. PowerShell's `$x = Get-Date` runs Get-Date and stores what it
    // returned, so the program is still there to be approved; skipping the
    // segment would hide it.
    expect(readCommandPrograms("$now = Get-Date", POWERSHELL_LIKE)).toEqual(["Get-Date"]);
    expect(readCommandPrograms("$out = node build.js", POWERSHELL_LIKE)).toEqual(["node"]);
  });

  it("still refuses a variable that really does name the program", () => {
    // The narrowing must not reach the case the refusal was written for: a
    // bare variable in program position, with no assignment under it.
    expect(() => readCommandPrograms("$TOOL build", POWERSHELL_LIKE)).toThrow(/variable/i);
    expect(() => readCommandPrograms("& $TOOL build", POWERSHELL_LIKE)).toThrow(/variable/i);
  });

  it("sees through quoting, assignments, redirects, and a call operator", () => {
    expect(readCommandPrograms("FOO=1 npm test", BASH_LIKE)).toEqual(["npm"]);
    expect(readCommandPrograms(`"${NODE}" -e "console.log(1)" > out.txt`, BASH_LIKE)).toEqual([
      "node",
    ]);
    // The call operator is PowerShell's, and 5.1 is exactly the interpreter
    // that does not honour `&` as a separator - so this is also the check that
    // the call-operator branch is reached before the separator question.
    expect(readCommandPrograms("& 'C:\\Program Files\\tool.exe' --flag", POWERSHELL_LIKE)).toEqual(
      ["tool"],
    );
    expect(readCommandPrograms("& 'C:\\Program Files\\tool.exe' --flag", BASH_LIKE)).toEqual([
      "tool",
    ]);
    expect(readCommandPrograms("npm run build &> log.txt", BASH_LIKE)).toEqual(["npm"]);
    expect(readCommandPrograms("node script.js 2>&1", BASH_LIKE)).toEqual(["node"]);
    // Redirect glue stays a token whatever the interpreter honours, so `&`
    // beside a `>` is never mistaken for a separator to refuse.
    expect(readCommandPrograms("node script.js 2>&1", POWERSHELL_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms("> preface.txt node script.js", BASH_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms("~/.local/bin/tool --flag", BASH_LIKE)).toEqual(["tool"]);
  });

  it("names what a wrapper runs, not the wrapper", () => {
    // `env node build.js` runs node. Naming `env` in the approval would put a
    // name in front of the user that is not the name that executes.
    expect(readCommandPrograms("env node build.js", BASH_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms("env FOO=1 npm test", BASH_LIKE)).toEqual(["npm"]);
    expect(readCommandPrograms("nohup node server.js", BASH_LIKE)).toEqual(["node"]);
  });

  it("strips the script extension a Windows shim is named by", () => {
    // npm.cmd, node.exe and gen.ps1 are one program each as far as a person
    // approving them is concerned.
    expect(readCommandPrograms("npm.cmd --version", CMD_LIKE)).toEqual(["npm"]);
    expect(readCommandPrograms("node.exe --version", CMD_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms("C:\\tools\\gen.ps1 -Name x", POWERSHELL_LIKE)).toEqual(["gen"]);
  });

  it("refuses what it cannot see, with the reason", () => {
    expect(() => readCommandPrograms("npm run $(whoami)", BASH_LIKE)).toThrow(/substitution/i);
    expect(() => readCommandPrograms("npm run `whoami`", BASH_LIKE)).toThrow(/substitution/i);
    expect(() => readCommandPrograms("grep x <(sort y)", BASH_LIKE)).toThrow(/substitution/i);
    expect(() => readCommandPrograms("npm test << EOF", BASH_LIKE)).toThrow(/substitution/i);
    expect(() => readCommandPrograms("$TOOL build", BASH_LIKE)).toThrow(/variable/i);
    expect(() => readCommandPrograms("%TOOL% build", BASH_LIKE)).toThrow(/variable/i);
    expect(() => readCommandPrograms('npm test "unterminated', BASH_LIKE)).toThrow(
      /unterminated quote/i,
    );
    expect(() => readCommandPrograms("npm && ; node", BASH_LIKE)).toThrow(/names no program/i);
    expect(() => readCommandPrograms("; npm test", BASH_LIKE)).toThrow(/names no program/i);
    expect(() => readCommandPrograms("--version", BASH_LIKE)).toThrow(/option, not a/i);
    // Control flow whose body opens with a test bracket: nothing there is a
    // program the reader can name.
    expect(() => readCommandPrograms("if [ -f x ]; then npm test; fi", BASH_LIKE)).toThrow(
      /names no program/i,
    );
  });

  it("refuses a cmd switch instead of naming it as a program", () => {
    // Measured before the fix: this returned ["d", "*", "echo"]. It did not
    // refuse - it asked a person to approve `shell:d` and `shell:*` for a
    // command that runs none of them. A resource named `*` is a grant nobody
    // would knowingly write.
    expect(() => readCommandPrograms("for /d %d in (*) do echo %d", CMD_LIKE)).toThrow(
      /"\/d".*option, not a program/is,
    );
    expect(() =>
      readCommandPrograms('for /f "tokens=1" %a in (list.txt) do echo %a', CMD_LIKE),
    ).toThrow(/"\/f".*option, not a program/is);
  });

  it("still reads an absolute POSIX path as the program it is", () => {
    // The negative control for the rule above: `/` opens an option on cmd and
    // a program everywhere else, so the rule is asked of the interpreter. If
    // it were applied everywhere, this would refuse.
    expect(readCommandPrograms("/usr/bin/node app.js", BASH_LIKE)).toEqual(["node"]);
    expect(readCommandPrograms("/bin/ls -la", BASH_LIKE)).toEqual(["ls"]);
  });

  it("refuses a filename pattern where a program belongs", () => {
    expect(() => readCommandPrograms("*.sh", BASH_LIKE)).toThrow(/pattern, not a program/i);
  });

  it("names parentheses as the cause when they are what split the line", () => {
    // Parentheses are read as grouping in every interpreter, so a cmd line
    // that uses them for a builtin body comes apart. Refusing is right;
    // refusing without naming the character sent an evaluation run looking for
    // a missing program that was never missing.
    const refusal = () => readCommandPrograms("(echo a & echo b)", CMD_LIKE);

    expect(refusal).toThrow(/parentheses/i);
    // And it says what to do instead, so the refusal is a next move.
    expect(refusal).toThrow(/script file/i);
  });

  it("keeps the plain refusal when no parenthesis is involved", () => {
    // The parenthesis sentence must not be attached to every empty segment, or
    // it becomes a wrong explanation offered confidently.
    expect(() => readCommandPrograms("npm && ; node", BASH_LIKE)).toThrow(
      /operator with nothing runnable/i,
    );
    expect(() => readCommandPrograms("npm && ; node", BASH_LIKE)).not.toThrow(/parentheses/i);
  });

  it("honours the separators its own kind was measured to honour", () => {
    // Binds the live table to this machine's resolved interpreter, so breaking
    // a row in `interpreter.ts` fails here. The fixtures above cannot catch
    // that - they carry their own copies of the values.
    const expected: Record<InterpreterKind, readonly CommandSeparator[]> = {
      bash: [";", "&", "&&", "||"],
      sh: [";", "&", "&&", "||"],
      pwsh: [";", "&&", "||"],
      cmd: ["&", "&&", "||"],
      powershell: [";"],
    };

    const interpreter = resolveInterpreter();
    expect(interpreter).toBeDefined();
    expect(interpreter?.separators).toEqual(expected[interpreter?.kind ?? "sh"]);
  });

  it("refuses at parse time, so an unparsable line is never approved", async () => {
    const approver = recordingApprover();

    await expect(
      run(gate({ approver }), { command: "$TOOL build" }),
    ).rejects.toBeInstanceOf(ToolError);

    expect(approver.asked).toEqual([]);
  });
});

describe("permissions see the program name, not the arguments", () => {
  it("matches on the program name", () => {
    expect(shellResource("node")).toBe("shell:node");
    // Lowercased, so a Windows caller naming NODE.EXE does not evade a rule.
    expect(shellResource("Node")).toBe("shell:node");
  });
});

describe("containment", () => {
  it("refuses to run anything when the policy did not opt in", async () => {
    await expect(
      run(gate({ allowExec: false }), { command: `${NODEQ} -e "0"` }),
    ).rejects.toBeInstanceOf(SandboxError);
  });

  itContained("does not hand the host environment to the command", async () => {
    // Inheriting process.env would give every program on the machine every
    // token on the machine. PATH is granted by the policy, by name; the rest
    // of the host environment is not there.
    process.env.STUDIO_SHELL_LEAK_CHECK = "leaked";

    const output = await run(gate(), {
      command: `${NODEQ} -e "console.log(String(process.env.STUDIO_SHELL_LEAK_CHECK))"`,
    });

    delete process.env.STUDIO_SHELL_LEAK_CHECK;
    expect(output).toContain("undefined");
  });

  itContained("receives the policy's PATH, because a shell must find programs", async () => {
    // `node` named bare, resolved by the interpreter through the PATH the
    // policy granted - the same grant a real `npm test` relies on.
    const output = await run(gate(), {
      command: `node -e "console.log(process.platform)"`,
    });

    expect(output).toContain(process.platform);
  });
});

describe("bad input", () => {
  it("needs a command", async () => {
    await expect(run(gate(), {})).rejects.toBeInstanceOf(ToolError);
    await expect(run(gate(), { command: "   " })).rejects.toBeInstanceOf(ToolError);
  });

  it("rejects a non-string command", async () => {
    await expect(run(gate(), { command: 42 })).rejects.toBeInstanceOf(ToolError);
  });
});

/**
 * Command lines arriving in the same batch.
 *
 * A model that decides to run the tests and the linter together returns both
 * calls in one assistant message, and they are dispatched together. The shell
 * has no per-path lock and cannot have one - what a command line touches is
 * not knowable from the line - so what is asserted here is the property that
 * is true: two commands are two independent child processes, and neither
 * waits on the other.
 *
 * The boundary is stated rather than hidden. Two shell calls writing the same
 * file are not serialized, and nothing here pretends otherwise: `write` and
 * `edit` are serialized because their path is declared, and a command line's
 * is not. Flue documents the same limit for its own `bash`.
 */
describe("command lines running together", () => {
  itContained("runs two command lines at once rather than one after the other", async () => {
    const instance = gate();
    const sleeper = (label: string) => ({
      command: `${NODEQ} -e "setTimeout(() => console.log('${label}'), 600)"`,
      timeout: 20,
    });

    // Warmed first. The very first contained spawn pays for setup the later
    // ones do not, and timing it as the baseline inflates the baseline enough
    // that a serialized pair still fits under the threshold - which is how an
    // earlier version of this test passed with the gate deliberately
    // serialized, measuring nothing at all.
    await run(instance, sleeper("warm"));

    // Calibrated against this machine rather than against a constant. Starting
    // a contained child is not free and costs more on some hosts than the
    // sleep does, so a fixed ceiling measures the host instead of the
    // behaviour.
    const aloneStarted = Date.now();
    await run(instance, sleeper("alone"));
    const alone = Date.now() - aloneStarted;

    const bothStarted = Date.now();
    const [first, second] = await Promise.all([
      run(instance, sleeper("one")),
      run(instance, sleeper("two")),
    ]);
    const both = Date.now() - bothStarted;

    expect(String(first)).toContain("one");
    expect(String(second)).toContain("two");
    // Overlapping, two calls cost about what one costs. Serialized they cost
    // twice. The threshold sits between those, well clear of both.
    expect(both).toBeLessThan(alone * 1.7);
  });

  itContained("keeps each command line's output to itself", async () => {
    const instance = gate();

    const [first, second] = await Promise.all([
      run(instance, { command: `${NODEQ} -e "console.log('alpha')"` }),
      run(instance, { command: `${NODEQ} -e "console.log('beta')"` }),
    ]);

    // Separate children, separate pipes. Shared buffering would show up here
    // as one call carrying the other's line.
    expect(String(first)).toContain("alpha");
    expect(String(first)).not.toContain("beta");
    expect(String(second)).toContain("beta");
    expect(String(second)).not.toContain("alpha");
  });

  itContained("reports one command line's failure without touching the other", async () => {
    const instance = gate();

    const [failing, fine] = await Promise.all([
      run(instance, { command: `${NODEQ} -e "process.exit(3)"` }),
      run(instance, { command: `${NODEQ} -e "console.log('unaffected')"` }),
    ]);

    // A non-zero exit is a result, not a thrown failure, so a batch does not
    // lose its other answers to one command that did not work.
    expect(String(failing)).toContain("exit code 3");
    expect(String(fine)).toContain("unaffected");
  });
});

/**
 * The background mode, through the tool rather than through the registry.
 *
 * The registry's own behaviour is covered in `background-jobs.test.ts`. What
 * is left to this file is the seam: that the flag reaches it, that a
 * composition without one refuses instead of quietly blocking, and that the
 * jobs tool only appears where there is somewhere to keep jobs.
 */
describe("running a command in the background", () => {
  /**
   * Ends every job and waits for the OS to let go.
   *
   * A live child holds its working directory open, and the suite's teardown
   * removes that directory - so a test that merely issues the kill races the
   * cleanup and fails with EPERM on a path that has nothing to do with what
   * it was testing.
   */
  async function releaseAll(jobs: BackgroundJobs): Promise<void> {
    jobs.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  it("returns a job id instead of waiting for the command to finish", async () => {
    const jobs = new BackgroundJobs();
    const instance = gate({ jobs });

    const answer = await run(instance, {
      command: `${NODEQ} -e "setInterval(() => {}, 1000)"`,
      background: true,
    });

    // A foreground call here would sit until its timeout; this one came back.
    // The id is matched by shape rather than spelled out: it carries a tag for
    // the run that minted it, so that a remembered id from before a restart
    // cannot land on a different process.
    expect(String(answer)).toMatch(/Started job_\w+ in the background/);
    expect(jobs.list(SCOPE.conversationId)).toHaveLength(1);
    await releaseAll(jobs);
  });

  it("reads and stops the job through the jobs tool", async () => {
    const jobs = new BackgroundJobs();
    const instance = gate({ jobs });
    await run(instance, {
      command: `${NODEQ} -e "setInterval(() => {}, 1000)"`,
      background: true,
    });

    const id = jobs.list(SCOPE.conversationId)[0]?.id ?? "";
    const listed = await instance.call({ name: "native/jobs", input: {}, scope: SCOPE });
    expect(String(listed)).toContain(id);

    await instance.call({
      name: "native/jobs",
      input: { id, stop: true },
      scope: SCOPE,
    });
    expect(jobs.get(SCOPE.conversationId, id)?.state).toBe("stopped");
    await releaseAll(jobs);
  });

  it("refuses to stop without being told which job", async () => {
    // Read as "stop everything", a forgotten id would take down a server the
    // caller still needed, with nothing in the call saying so.
    const instance = gate({ jobs: new BackgroundJobs() });

    await expect(
      instance.call({ name: "native/jobs", input: { stop: true }, scope: SCOPE }),
    ).rejects.toThrow(/id of the job to stop/);
  });

  it("says so rather than blocking when there is nowhere to keep a job", async () => {
    // A caller that asked not to wait must not be made to wait.
    const instance = gate();

    await expect(
      run(instance, { command: `${NODEQ} -e "0"`, background: true }),
    ).rejects.toThrow(/cannot run background commands/);
  });
})
