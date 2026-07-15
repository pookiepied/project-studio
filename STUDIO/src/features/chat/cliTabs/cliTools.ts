import type { ComponentType } from "react";
import { ClaudeCodeIcon, CodexIcon, OpencodeIcon, StudioIcon } from "@/ui/brand";
import type { LocalCapabilityId } from "@/runtime";

export type CliToolId = "claude" | "codex" | "opencode";

export interface CliTool {
  id: CliToolId;
  label: string;
  /** Program spawned directly in the PTY (no shell echo). */
  program: string;
  args: string[];
  capabilityId: LocalCapabilityId;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

/** Launchable coding-agent CLIs. Availability is resolved against the local
 *  capability snapshot so the launcher only offers CLIs actually on PATH. */
export const CLI_TOOLS: readonly CliTool[] = [
  {
    id: "claude",
    label: "Claude Code",
    program: "claude",
    args: [],
    capabilityId: "claude-cli",
    Icon: ClaudeCodeIcon,
  },
  {
    id: "codex",
    label: "Codex CLI",
    program: "codex",
    args: [],
    capabilityId: "codex-cli",
    Icon: CodexIcon,
  },
  {
    id: "opencode",
    label: "opencode",
    program: "opencode",
    args: [],
    capabilityId: "opencode-cli",
    Icon: OpencodeIcon,
  },
];

export function getCliTool(id: CliToolId): CliTool {
  const tool = CLI_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown CLI tool: ${id}`);
  return tool;
}

export { StudioIcon };
