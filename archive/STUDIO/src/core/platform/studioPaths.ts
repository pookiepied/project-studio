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

/** Root for per-project Studio data (never the user's source folder). */
export async function getStudioProjectsHome(): Promise<string> {
  return joinStudioPath(await getStudioHome(), "data", "projects");
}

/** The project registry file — the canonical list of known projects. */
export async function getStudioProjectRegistryPath(): Promise<string> {
  return joinStudioPath(await getStudioHome(), "data", "projects.json");
}

/** Studio's own data folder for one project, e.g. …/data/projects/<id>/ */
export async function getStudioProjectDir(projectId: string): Promise<string> {
  return joinStudioPath(await getStudioProjectsHome(), projectId);
}
