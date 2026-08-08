import { invoke } from "@tauri-apps/api/core";

const CLAUDE_DIR = ".claude";
const PROJECTS_DIR = "projects";
const CLAUDE_NATIVE_ID_PREFIX = "claude-native:";

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = part.replace(/\\/g, "/");
      if (index === 0) return normalized.replace(/\/+$/g, "");
      return normalized.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

export async function getClaudeProjectsRoot(): Promise<string> {
  const home = await invoke<string>("get_home_dir");
  return joinPath(home, CLAUDE_DIR, PROJECTS_DIR);
}

export function getClaudeProjectKeyFromPath(projectPath: string): string {
  return projectPath
    .trim()
    .replace(/\\/g, "/")
    .split("")
    .map((char) => /[A-Za-z0-9._-]/.test(char) ? char : "-")
    .join("")
    .replace(/^-+|-+$/g, "");
}

export async function getClaudeProjectDir(projectPath: string): Promise<string> {
  return joinPath(await getClaudeProjectsRoot(), getClaudeProjectKeyFromPath(projectPath));
}

export function makeClaudeNativeConversationId(projectKey: string, sessionId: string): string {
  return `${CLAUDE_NATIVE_ID_PREFIX}${encodeURIComponent(projectKey)}:${sessionId}`;
}

export function parseClaudeNativeConversationId(id: string): { projectKey: string; sessionId: string } | null {
  if (!id.startsWith(CLAUDE_NATIVE_ID_PREFIX)) return null;
  const rest = id.slice(CLAUDE_NATIVE_ID_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  if (separator <= 0) return null;
  return {
    projectKey: decodeURIComponent(rest.slice(0, separator)),
    sessionId: rest.slice(separator + 1),
  };
}

export async function getClaudeTranscriptPath(projectKey: string, sessionId: string): Promise<string> {
  return joinPath(await getClaudeProjectsRoot(), projectKey, `${sessionId}.jsonl`);
}
