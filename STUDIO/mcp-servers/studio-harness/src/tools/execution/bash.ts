import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";

export async function executeBash(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = args.command as string;
  const cwd = (args.cwd as string) || process.cwd();
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.SHELL_COMMAND;
  const maxOutputChars = args.max_output_chars as number | undefined;

  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd" : "/bin/sh";
  const shellArgs = isWindows ? ["/C", command] : ["-c", command];

  return runProcess(shell, shellArgs, { cwd, timeout, maxOutputChars });
}
