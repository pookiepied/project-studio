import { invoke } from "@tauri-apps/api/core";

export type StudioPathKind =
  | "config"
  | "data"
  | "conversations"
  | "uploads"
  | "generated"
  | "mcp"
  | "mcpServers"
  | "mcpManifests"
  | "mcpLogs"
  | "skills"
  | "cache"
  | "temp"
  | "logs"
  | "secrets";

const PATH_SEGMENTS: Record<StudioPathKind, string[]> = {
  config:       ["config"],
  data:         ["data"],
  conversations:["data", "conversations"],
  uploads:      ["data", "uploads"],
  generated:    ["data", "generated"],
  mcp:          ["mcp"],
  mcpServers:   ["mcp", "servers"],
  mcpManifests: ["mcp", "manifests"],
  mcpLogs:      ["mcp", "logs"],
  skills:       ["skills"],
  cache:        ["cache"],
  temp:         ["temp"],
  logs:         ["logs"],
  secrets:      ["secrets"],
};

let studioHomeCache: string | null = null;

export function joinStudioPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = part.replace(/\\/g, "/");
      if (index === 0) return normalized.replace(/\/+$/g, "");
      return normalized.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

export async function getStudioHome(): Promise<string> {
  if (studioHomeCache) return studioHomeCache;
  studioHomeCache = await invoke<string>("get_studio_home_dir");
  return studioHomeCache;
}

export async function getStudioPath(kind: StudioPathKind): Promise<string> {
  return joinStudioPath(await getStudioHome(), ...PATH_SEGMENTS[kind]);
}

export async function getStudioConfigHome(): Promise<string> {
  return getStudioPath("config");
}

export async function getStudioDataHome(): Promise<string> {
  return getStudioPath("data");
}

export async function getStudioConversationHome(): Promise<string> {
  return getStudioPath("conversations");
}

export async function getStudioUploadHome(): Promise<string> {
  return getStudioPath("uploads");
}

export async function getStudioGeneratedHome(): Promise<string> {
  return getStudioPath("generated");
}

export async function getStudioMcpHome(): Promise<string> {
  return getStudioPath("mcp");
}

export async function getStudioMcpServersHome(): Promise<string> {
  return getStudioPath("mcpServers");
}

export async function getStudioMcpManifestsHome(): Promise<string> {
  return getStudioPath("mcpManifests");
}

export async function getStudioMcpLogsHome(): Promise<string> {
  return getStudioPath("mcpLogs");
}

export async function getStudioSkillsHome(): Promise<string> {
  return getStudioPath("skills");
}

export async function getStudioCacheHome(): Promise<string> {
  return getStudioPath("cache");
}

export async function getStudioTempHome(): Promise<string> {
  return getStudioPath("temp");
}

export async function getStudioLogsHome(): Promise<string> {
  return getStudioPath("logs");
}

export async function getStudioSecretsHome(): Promise<string> {
  return getStudioPath("secrets");
}

export function clearStudioHomeCache(): void {
  studioHomeCache = null;
}
