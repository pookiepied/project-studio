import { existsSync } from "fs";
import { join } from "path";
import { resolveVendoredGitBash } from "../shared/vendor.js";

/**
 * Shell resolution shared by the blocking `bash` tool and the managed
 * background-process tools. Both must run commands through the *same* real
 * shell so quoting, heredocs, and special characters behave identically
 * whether a command is foreground (bash) or long-lived (start_process).
 *
 * On Windows we deliberately use Git Bash (vendored → PATH), never cmd.exe or
 * the WSL `System32\bash.exe` launcher — see bash.ts for the rationale.
 */

/**
 * Locate a PATH-installed Git Bash on Windows (fallback when the vendored tree
 * isn't present — e.g. a dev checkout before `vendor:sync git`).
 */
export function findPathGitBash(): string | null {
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

export interface ResolvedShell {
  /** Absolute path (Windows) or `/bin/sh` (POSIX) to the shell executable. */
  shell: string;
  /** Build the argv that runs `command` non-interactively in this shell. */
  argsFor: (command: string) => string[];
}

/**
 * Resolve the shell used to run command strings. Returns an error string when
 * no usable shell exists (Windows without Git Bash) so callers can surface the
 * standard, actionable message instead of spawning something divergent.
 */
export function resolveShell(): ResolvedShell | { error: string } {
  if (process.platform === "win32") {
    const bash = resolveVendoredGitBash() ?? findPathGitBash();
    if (!bash) {
      return {
        error:
          "No bash shell available. STUDIO bundles Git Bash under vendor/git — " +
          "if you see this, the bundled runtime is missing; reinstall or repair STUDIO. " +
          "(For reference: run `npm run vendor:sync git` in the STUDIO folder to populate it in a dev checkout.)",
      };
    }
    return { shell: bash, argsFor: (command) => ["-c", command] };
  }
  return { shell: "/bin/sh", argsFor: (command) => ["-c", command] };
}
