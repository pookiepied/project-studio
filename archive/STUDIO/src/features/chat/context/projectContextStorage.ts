export type ProjectCtx = { path: string; name: string; accessMode?: "review" | "autonomous" };

const PROJ_CTX_MAP_KEY = "studio_project_contexts";

export function getConvProjectCtx(convId: string): ProjectCtx | null {
  try {
    const map = JSON.parse(localStorage.getItem(PROJ_CTX_MAP_KEY) || "{}");
    return map[convId] ?? null;
  } catch {
    return null;
  }
}

export function saveConvProjectCtx(convId: string, ctx: ProjectCtx | null): void {
  try {
    const map = JSON.parse(localStorage.getItem(PROJ_CTX_MAP_KEY) || "{}");
    if (ctx) map[convId] = ctx;
    else delete map[convId];
    localStorage.setItem(PROJ_CTX_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage failures */
  }
}
