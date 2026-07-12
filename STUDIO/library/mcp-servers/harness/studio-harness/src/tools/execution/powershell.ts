import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";

export async function executePowerShell(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = args.command as string;
  const cwd = (args.cwd as string) || process.cwd();
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.SHELL_COMMAND;
  const maxOutputChars = args.max_output_chars as number | undefined;

  return runProcess(
    "powershell.exe",
    ["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd, timeout, maxOutputChars }
  );
}
