import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

/**
 * Whether this machine can be driven, said before anyone asks it to be.
 *
 * The browser's lesson (ADR 0049, 2026-09-15 amendment): the server process
 * starts fine on a machine that cannot do the job, and the failure lands in
 * the first tool call, inside a conversation, which is the worst place for a
 * person to learn about it. So the settings row says what the first call
 * would find. "Seen" rather than "will work": only a launch decides.
 */
export interface ComputerEngineReport {
  /** Whether a driver can be started here at all. */
  readonly available: boolean;
  /** One sentence for a row. */
  readonly summary: string;
}

/**
 * Where Windows PowerShell 5.1 always is. It ships with Windows and cannot
 * be removed.
 *
 * An absolute path, never the bare name: the computer server is launched by
 * the harness with the environment ADR 0039 gives a child, which carries no
 * PATH to resolve a bare name against - measured on 2026-09-15 as `spawn
 * powershell.exe ENOENT` in the first real turn. `SystemRoot` may be absent
 * for the same reason, so the default is the one Windows has used since XP.
 */
export function windowsPowerShell(): string {
  const root = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function computerReport(): ComputerEngineReport {
  const os = platform();
  if (os !== "win32") {
    const name = os === "darwin" ? "macOS" : os === "linux" ? "Linux" : os;
    return {
      available: false,
      summary: `Not available on ${name} in this version. Studio drives the desktop through what Windows already has; a driver for ${name} is not built yet.`,
    };
  }
  const shell = windowsPowerShell();
  if (!existsSync(shell)) {
    return {
      available: false,
      summary: `Windows PowerShell was not found at ${shell}. It ships with Windows; a machine without it cannot be driven.`,
    };
  }
  return {
    available: true,
    summary: "Drives this computer through Windows PowerShell: screen, mouse, keyboard, windows and controls.",
  };
}
