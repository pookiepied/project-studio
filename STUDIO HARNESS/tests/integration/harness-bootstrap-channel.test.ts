import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { afterEach, describe, expect, it } from "vitest";

import { desktopHostSource } from "../desktop-host.js";

/**
 * The Windows bootstrap channel, exercised rather than argued about.
 *
 * The Host hands the Harness its admission credential over a pipe so that it
 * never appears in an environment or on a command line (008.5). On Unix that
 * pipe is file descriptor 4, mapped into place by `command-fds`. `command-fds`
 * is POSIX — `dup2` inside a `pre_exec` hook — and it was declared as an
 * unconditional dependency of the desktop Host, so **the Host had never
 * compiled on Windows at all**, and the channel it needs there did not exist
 * (meta-task #87).
 *
 * The Windows transport moves the same protocol onto descriptors every process
 * already has: the bootstrap arrives on stdin, and the readiness frame goes out
 * on stdout among the Harness's ordinary logging. `channel.rs` states the
 * decision and owns both transports.
 *
 * This file is the half that can be checked from here. The Rust half has its
 * own `#[cfg(test)]` tests, but those assert how the command is configured;
 * only running the real entrypoint proves the Node side reads descriptor 0 and
 * writes descriptor 1, which is the part the Rust tests cannot see.
 */

const SERVER = join(import.meta.dirname, "..", "..", "dist", "server.mjs");
/** Found rather than assumed — see `tests/desktop-host.ts`. */
const RUST_CHANNEL = desktopHostSource("channel.rs");

const CREDENTIAL = "c".repeat(43);

interface Started {
  readonly readiness: Record<string, unknown>;
  /** Every line that arrived on stdout before the frame did. */
  readonly preceding: string[];
}

let child: ChildProcessWithoutNullStreams | undefined;
let home: string | undefined;

afterEach(async () => {
  if (child !== undefined) {
    const exited = new Promise<void>((resolve) => child?.once("exit", () => resolve()));
    child.kill();
    await exited;
    child = undefined;
  }
  // Awaited above, because the Harness holds its database open and Windows
  // refuses to unlink a file a live process has mapped. Still tolerant: a
  // leftover temp directory must not turn into a failing test.
  if (home !== undefined) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* the OS will collect it */
    }
  }
  home = undefined;
});

async function startOverStdio(): Promise<Started> {
  home = mkdtempSync(join(tmpdir(), "studio-channel-"));

  const spawned = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PROJECT_STUDIO_HOME: home,
      PROJECT_STUDIO_DB_PATH: join(home, "studio.db"),
      PROJECT_STUDIO_STORE_PATH: join(home, "store"),
      PORT: "0",
      PROJECT_STUDIO_HARNESS_HOSTNAME: "127.0.0.1",
      // The Windows transport, stated the way the Host states it.
      PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD: "0",
      PROJECT_STUDIO_READINESS_FD: "1",
    },
  });
  child = spawned;

  spawned.stdin.write(
    JSON.stringify({
      credential: CREDENTIAL,
      clientId: "studio-host",
      sessionId: "session-under-test",
    }),
  );
  spawned.stdin.end();

  const preceding: string[] = [];
  const lines = createInterface({ input: spawned.stdout });
  for await (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      preceding.push(line);
      continue;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "project-studio.harness.ready"
    ) {
      return { readiness: parsed as Record<string, unknown>, preceding };
    }
    preceding.push(line);
  }

  throw new Error(`stdout ended without a readiness frame. Saw:\n${preceding.join("\n")}`);
}

describe("the Windows bootstrap channel", () => {
  it(
    "reads the credential from stdin and answers on stdout",
    async () => {
      const { readiness } = await startOverStdio();

      expect(readiness.host).toBe("127.0.0.1");
      expect(readiness.port).toBeTypeOf("number");
      expect(readiness.port).toBeGreaterThan(0);

      // These two came *out* of the bootstrap that went *in* over stdin. If the
      // entrypoint had not read descriptor 0 they would be empty strings, and
      // the Harness would be running with no admission identity at all.
      expect(readiness.clientId).toBe("studio-host");
      expect(readiness.sessionId).toBe("session-under-test");
    },
    60_000,
  );

  it(
    "puts the frame behind lines that are not the frame",
    async () => {
      // The reason `ReadinessStream::exclusive` exists. The previous Rust
      // reader took the first line it saw and failed if that line was not the
      // frame — correct for a dedicated descriptor, and wrong here, where the
      // Harness's own startup logging shares the stream.
      const { preceding } = await startOverStdio();
      expect(preceding.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "stays up and keeps its output stream open after publishing readiness",
    async () => {
      // Startup is not the end of the child's life, and the Host stops sampling
      // the stream once the frame arrives. A Harness that publishes readiness
      // and then dies, or whose stdout ends, is a Harness the desktop app will
      // report as running.
      //
      // Deliberately **not** claimed here: that this covers the `closeSync`
      // guard below. It does not, and that was measured rather than assumed —
      // with the guard removed from `dist/server.mjs` this test still passed,
      // because on Node 22.18 for Windows `closeSync(1)` left both `console.log`
      // and `writeSync(1, …)` working and produced no EOF. The structural test
      // is what holds the guard; see its comment for why the guard stays.
      const { readiness } = await startOverStdio();
      expect(readiness.port).toBeGreaterThan(0);

      const ended = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2_000);
        child?.stdout.once("end", () => {
          clearTimeout(timer);
          resolve(true);
        });
      });

      expect(ended).toBe(false);
      expect(child?.exitCode).toBeNull();
    },
    60_000,
  );
});

describe("the generated entrypoint and the Rust channel", () => {
  // The same structural guard as the environment allowlist (ADR 0039): two
  // sides that cannot import each other, bound by a test, because each is
  // internally consistent and drift is silent.
  const entrypoint = (): string => readFileSync(SERVER, "utf8");
  const rust = (): string => readFileSync(RUST_CHANNEL, "utf8");

  it("agree on the two variable names", () => {
    for (const name of [
      "PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD",
      "PROJECT_STUDIO_READINESS_FD",
    ]) {
      expect(entrypoint(), `${name} missing from dist/server.mjs`).toContain(name);
      expect(rust(), `${name} missing from channel.rs`).toContain(name);
    }
  });

  it("guards the standard descriptors against being closed", () => {
    // Reading the built artefact rather than the patch file, because the patch
    // applying is not the same claim as the guard reaching the code that runs.
    //
    // **Why the guard stays even though closing fd 1 was measured harmless.**
    // On Node 22.18 for Windows, `closeSync(1)` left stdout fully working — so
    // this is not fixing an observed break on the platform it was written for.
    // It stays because the failure it prevents is silent and platform-specific
    // rather than absent: on POSIX a closed descriptor 1 is the *lowest free
    // number*, so the next file the Harness opens becomes descriptor 1 and
    // every later stdout write is appended to that file instead. Nothing
    // reports it. The Unix transport does not reach this code today — its
    // readiness descriptor is 3 — which is exactly the kind of "cannot happen
    // here" that stops being true when a transport is unified later.
    expect(entrypoint()).toContain("if (bootstrapFd > 2) closeSync(bootstrapFd)");
    expect(entrypoint()).toContain("if (readinessFd > 2) closeSync(readinessFd)");
  });

  it("never puts the credential in the environment", () => {
    // The entrypoint assigns it to `process.env` *inside its own process* after
    // reading the pipe, which is how the rest of the Harness consumes it. What
    // must never happen is the Host passing it that way to begin with.
    expect(rust()).not.toMatch(/env\(\s*"PROJECT_STUDIO_ADMISSION_CREDENTIAL"/);
  });
});
