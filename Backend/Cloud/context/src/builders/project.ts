import type { ProjectContext } from "../contracts";
import type { Env } from "../system/env";

/**
 * Project and file layer (§19.7): relevant files, project structure,
 * documentation, uploads, artifacts, and local/cloud workspace state.
 */
export async function buildProjectContext(
  env: Env,
  userId: string,
  _task: string,
): Promise<ProjectContext> {
  const response = await env.REGISTRY.fetch("http://registry/mcp", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry workspace lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: Array<{ ref: { id: string }; location: "cloud" | "local"; enabled: boolean; available: boolean }> }>();
  const harness = items.find((item) => item.ref.id === "studio-harness" && item.enabled && item.available);
  return { relevantFiles: [], documentation: [], workspace: { location: harness?.location ?? "local", available: Boolean(harness) } };
}
