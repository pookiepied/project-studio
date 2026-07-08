import { runProcess } from "./run_process.js";
import { TOOL_TIMEOUTS } from "../tool-contract.js";

function parsePS(result: Awaited<ReturnType<typeof runProcess>>): unknown {
  if (result.exit_code !== 0 || result.error) {
    return {
      error: (result.error as string) || (result.stderr as string) || "PowerShell command failed",
      exit_code: result.exit_code,
    };
  }
  const out = (result.stdout as string).trim();
  if (!out) return { success: true };
  try {
    return JSON.parse(out);
  } catch {
    return { output: out };
  }
}

export async function runPS(script: string, timeoutMs: number = TOOL_TIMEOUTS.FAST_QUERY): Promise<unknown> {
  const result = await runProcess(
    "powershell.exe",
    ["-NonInteractive", "-NoProfile", "-Command", script],
    { cwd: process.cwd(), timeout: timeoutMs }
  );
  return parsePS(result);
}

// Run PowerShell in Multi-Threaded Apartment (MTA) mode.
// Required for WinRT APIs (Windows.Media.Ocr, Windows.Graphics.Imaging, etc.)
// which throw COM exceptions when called from the default STA apartment.
export async function runPSMTA(script: string, timeoutMs: number = TOOL_TIMEOUTS.FAST_QUERY): Promise<unknown> {
  const result = await runProcess(
    "powershell.exe",
    ["-MTA", "-NonInteractive", "-NoProfile", "-Command", script],
    { cwd: process.cwd(), timeout: timeoutMs }
  );
  return parsePS(result);
}
