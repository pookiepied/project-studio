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
  /** URL to install / download the CLI (opened when not found on PATH). */
  installUrl: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}

export const CLI_TOOLS: readonly CliTool[] = [
  {
    id: "claude",
    label: "Claude Code",
    program: "claude",
    args: [],
    capabilityId: "claude-cli",
    installUrl: "https://docs.anthropic.com/en/docs/claude-code/overview",
    Icon: ClaudeCodeIcon,
  },
  {
    id: "codex",
    label: "Codex CLI",
    program: "codex",
    args: [],
    capabilityId: "codex-cli",
    installUrl: "https://github.com/openai/codex",
    Icon: CodexIcon,
  },
  {
    id: "opencode",
    label: "OpenCode",
    program: "opencode",
    args: [],
    capabilityId: "opencode-cli",
    installUrl: "https://opencode.ai/install",
    Icon: OpencodeIcon,
  },
];

export function getCliTool(id: CliToolId): CliTool {
  const tool = CLI_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown CLI tool: ${id}`);
  return tool;
}

export { StudioIcon };
