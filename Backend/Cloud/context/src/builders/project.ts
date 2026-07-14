import type { ProjectContext } from "../contracts";
import type { Env } from "../system/env";

/**
 * Project and file layer: relevant files, project structure, documentation,
 * uploads, artifacts, and local/cloud workspace state.
 */
export async function buildProjectContext(
  env: Env,
  userId: string,
  _task: string,
): Promise<ProjectContext> {
  const response = await env.REGISTRY.fetch("http://registry/mcp", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry workspace lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: Array<{ id: string; status: string }> }>();
  const harness = items.find((item) => item.id === "studio-harness" && item.status === "active");
  return { relevantFiles: [], documentation: [], workspace: { location: "local", available: Boolean(harness) } };
}
