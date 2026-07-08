import { existsSync } from "fs";
import { join } from "path";
import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { resolveVendoredGitBash } from "../shared/vendor.js";

/**
 * Locate a PATH-installed Git Bash on Windows (priority fallback when the
 * vendored tree isn't present — e.g. during dev before `vendor:sync git`).
 *
 * We deliberately do NOT use `System32\bash.exe` (the WSL launcher): it runs in
 * a Linux-filesystem context with different cwd and path-translation semantics,
 * which breaks commands issued against Windows paths.
 */
function findPathGitBash(): string | null {
  const candidates: string[] = [];
  if (process.env.STUDIO_GIT_BASH) candidates.push(process.env.STUDIO_GIT_BASH);
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
    // Priority: vendored Git Bash → PATH-installed Git Bash → clear error.
    // Real bash (not cmd.exe) so heredocs, quoting, and special characters like
    // &, (), and quotes behave correctly. No cmd.exe fallback by design.
    const bash = resolveVendoredGitBash() ?? findPathGitBash();
    if (!bash) {
      return {
        stdout: "",
        stderr:
          "No bash shell available. STUDIO bundles Git Bash under vendor/git — " +
          "if you see this, the bundled runtime is missing; reinstall or repair STUDIO. " +
          "(For reference: run `npm run vendor:sync git` in the STUDIO folder to populate it in a dev checkout.)",
        exit_code: 127,
        error: "bash unavailable",
      };
    }
    shell = bash;
    shellArgs = ["-c", command];
  } else {
    shell = "/bin/sh";
    shellArgs = ["-c", command];
  }

  return runProcess(shell, shellArgs, { cwd, timeout, maxOutputChars });
}
