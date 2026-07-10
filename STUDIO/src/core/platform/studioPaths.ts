import { invoke } from "@tauri-apps/api/core";

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

async function getStudioHome(): Promise<string> {
  if (studioHomeCache) return studioHomeCache;
  studioHomeCache = await invoke<string>("get_studio_home_dir");
  return studioHomeCache;
}

export async function getStudioConversationHome(): Promise<string> {
  return joinStudioPath(await getStudioHome(), "data", "conversations");
}
