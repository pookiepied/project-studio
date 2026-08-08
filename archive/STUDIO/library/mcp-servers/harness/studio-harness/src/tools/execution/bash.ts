import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";
import { resolveShell } from "./shell.js";

// Shell resolution (vendored Git Bash → PATH Git Bash → clear error on Windows;
// /bin/sh on POSIX) is shared with the managed background-process tools — see
// shell.ts. Real bash, never cmd.exe or the WSL launcher, so heredocs, quoting,
// and special characters like &, (), and quotes behave correctly.

export async function executeBash(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = args.command as string;
  const cwd = (args.cwd as string) || process.cwd();
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.SHELL_COMMAND;
  const maxOutputChars = args.max_output_chars as number | undefined;

  const resolved = resolveShell();
  if ("error" in resolved) {
    return { stdout: "", stderr: resolved.error, exit_code: 127, error: "bash unavailable" };
  }

  return runProcess(resolved.shell, resolved.argsFor(command), { cwd, timeout, maxOutputChars });
}
