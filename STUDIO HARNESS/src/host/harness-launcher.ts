import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";

import { createAdmissionSession } from "../admission/verifier.js";
import { ProcessError } from "../process/errors.js";
import { parseHarnessReadiness, type HarnessReadiness } from "./readiness.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const READINESS_FD = 3;
const BOOTSTRAP_FD = 4;

export interface HarnessLauncherOptions {
  /** Built Flue Node artifact. Defaults to `dist/server.mjs` under `cwd`. */
  readonly serverPath?: string;
  /** Directory used by the child for Project Studio paths and configuration. */
  readonly cwd?: string;
  readonly clientId?: string;
  readonly startupTimeoutMs?: number;
  /** Additional non-admission environment supplied by the trusted owner. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface RunningHarness {
  readonly process: ChildProcess;
  readonly credential: string;
  readonly readiness: HarnessReadiness;
  readonly baseUrl: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  stop(): Promise<void>;
}

function tail(value: string): string {
  return value.length > 2_000 ? `...${value.slice(-2_000)}` : value;
}

function safeOutput(value: string, credential: string): string {
  return tail(value.replaceAll(credential, "[redacted]"));
}

function childExitMessage(
  child: ChildProcess,
  stdout: string,
  stderr: string,
  credential: string,
): string {
  return [
    `Harness exited before readiness (pid=${String(child.pid)}, exitCode=${String(child.exitCode)}, signal=${String(child.signalCode)}).`,
    `stdout=${safeOutput(stdout, credential) || "(nothing)"}`,
    `stderr=${safeOutput(stderr, credential) || "(nothing)"}`,
  ].join("\n");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

/**
 * Starts the built Harness as a loopback-only child and waits for an actual
 * endpoint frame. This is the standalone/test owner seam; the Tauri Host can
 * consume the same contract later without changing the Harness process.
 */
export async function launchHarness(
  options: HarnessLauncherOptions = {},
): Promise<RunningHarness> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const serverPath = resolve(options.serverPath ?? join(cwd, "dist/server.mjs"));
  const admission = createAdmissionSession({
    clientId: options.clientId ?? "studio-host",
    clientType: "studio-host",
  });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.environment,
    PORT: "0",
    PROJECT_STUDIO_HARNESS_HOSTNAME: "127.0.0.1",
    PROJECT_STUDIO_READINESS_FD: String(READINESS_FD),
    PROJECT_STUDIO_ADMISSION_BOOTSTRAP_FD: String(BOOTSTRAP_FD),
  };
  delete environment.PROJECT_STUDIO_ADMISSION_CREDENTIAL;
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: environment,
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const bootstrapStream = child.stdio[BOOTSTRAP_FD];
  if (
    bootstrapStream === undefined ||
    bootstrapStream === null ||
    typeof bootstrapStream === "number" ||
    !("end" in bootstrapStream)
  ) {
    await stopChild(child);
    throw new ProcessError("internal", {
      message: "The Harness admission bootstrap channel could not be created.",
    });
  }
  bootstrapStream.end(
    JSON.stringify({
      credential: admission.credential,
      clientId: admission.context.clientId,
      sessionId: admission.context.sessionId,
    }),
  );

  const readinessStream = child.stdio[READINESS_FD];
  if (readinessStream === null || typeof readinessStream === "number") {
    await stopChild(child);
    throw new ProcessError("internal", {
      message: "The Harness readiness channel could not be created.",
    });
  }

  const timeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const readiness = await new Promise<HarnessReadiness>((resolveReady, rejectReady) => {
    const reader = createInterface({ input: readinessStream as Readable });
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.close();
      callback();
    };
    const timer = setTimeout(() => {
      finish(() =>
        rejectReady(
          new ProcessError("timeout", {
            message: `The Harness did not publish loopback readiness within ${timeoutMs}ms.`,
          }),
        ),
      );
    }, timeoutMs);

    reader.on("line", (line) => {
      const parsed = parseHarnessReadiness(line);
      if (parsed !== undefined) finish(() => resolveReady(parsed));
    });
    child.once("error", (cause) => {
      finish(() => rejectReady(new ProcessError("spawn_failed", { cause })));
    });
    child.once("exit", () => {
      finish(() =>
        rejectReady(
          new ProcessError("spawn_failed", {
            message: childExitMessage(child, stdout, stderr, admission.credential),
          }),
        ),
      );
    });
  }).catch(async (error: unknown) => {
    await stopChild(child);
    throw error;
  });

  return {
    process: child,
    credential: admission.credential,
    readiness,
    baseUrl: `http://${readiness.host}:${readiness.port}`,
    stdout: () => safeOutput(stdout, admission.credential),
    stderr: () => safeOutput(stderr, admission.credential),
    stop: () => stopChild(child),
  };
}
