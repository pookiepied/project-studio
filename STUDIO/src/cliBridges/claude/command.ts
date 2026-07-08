import { invoke } from "@tauri-apps/api/core";

export async function runClaudeCommand(args: string[]): Promise<string> {
  return invoke<string>("execute_shell_command", {
    command: "claude",
    args,
  });
}

export async function runClaudeJsonCommand<T>(args: string[]): Promise<T> {
  const raw = await runClaudeCommand(args);
  return JSON.parse(raw) as T;
}
