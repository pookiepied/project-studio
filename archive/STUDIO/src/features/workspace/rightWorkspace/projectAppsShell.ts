/**
 * projectAppsShell — shared PowerShell helpers for detecting and launching the
 * external project apps (VS Code, Cursor, File Explorer, …). Extracted so the
 * cached detection module and the launcher UI don't duplicate quoting logic.
 */

import { invoke } from "@tauri-apps/api/core";

export function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function psArray(values: string[]): string {
  return "@(" + values.map(psString).join(",") + ")";
}

export async function runPowerShell(script: string): Promise<string> {
  return invoke<string>("execute_shell_command", {
    command: "powershell",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
  });
}
