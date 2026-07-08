import { existsSync } from "fs";
import { join } from "path";
import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";

/**
 * Locate a real Git Bash on Windows.
 *
 * We deliberately do NOT use `System32\bash.exe` (the WSL launcher): it runs in
 * a Linux-filesystem context with different cwd and path-translation semantics,
 * which breaks commands issued against Windows paths. Git Bash operates directly
 * on the Windows filesystem, so a Windows `cwd` and Windows tooling (node, npm,
 * git) behave as expected.
 *
 * Returns the resolved bash.exe path, or null when Git Bash isn't installed
 * (caller falls back to cmd.exe).
 */
function findGitBash(): string | null {
  const candidates: string[] = [];

  // Explicit override wins.
  if (process.env.STUDIO_GIT_BASH) candidates.push(process.env.STUDIO_GIT_BASH);

  // Standard install locations.
  for (const base of [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
  ]) {
    if (base) candidates.push(join(base, "Git", "bin", "bash.exe"));
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function executeBash(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = args.command as string;
  const cwd = (args.cwd as string) || process.cwd();
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.SHELL_COMMAND;
  const maxOutputChars = args.max_output_chars as number | undefined;

  let shell: string;
  let shellArgs: string[];

  if (process.platform === "win32") {
    // Prefer real bash (Git Bash) so heredocs, quoting, and special characters
    // like &, (), and quotes behave correctly. cmd.exe mangles all of these and
    // has no heredoc — fall back to it only when Git Bash isn't installed.
    const gitBash = findGitBash();
    if (gitBash) {
      shell = gitBash;
      shellArgs = ["-c", command];
    } else {
      shell = "cmd";
      shellArgs = ["/C", command];
    }
  } else {
    shell = "/bin/sh";
    shellArgs = ["-c", command];
  }

  return runProcess(shell, shellArgs, { cwd, timeout, maxOutputChars });
}
