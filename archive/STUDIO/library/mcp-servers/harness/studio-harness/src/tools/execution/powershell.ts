import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";

export async function executePowerShell(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = args.command as string;
  const cwd = (args.cwd as string) || process.cwd();
  const timeout = (args.timeout as number) || TOOL_TIMEOUTS.SHELL_COMMAND;
  const maxOutputChars = args.max_output_chars as number | undefined;

  // Force UTF-8 output so non-ASCII characters decode correctly. PowerShell
  // otherwise emits the console's legacy code page, which the UTF-8 decoder in
  // run_process would turn into mojibake.
  const utf8Command =
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; " +
    command;

  return runProcess(
    "powershell.exe",
    ["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", utf8Command],
    { cwd, timeout, maxOutputChars }
  );
}
