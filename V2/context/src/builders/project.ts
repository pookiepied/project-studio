import type { ProjectContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Project and file layer (§19.7): relevant files, project structure,
 * documentation, uploads, artifacts, and local/cloud workspace state.
 */
export async function buildProjectContext(
  _env: Env,
  _userId: string,
  _task: string,
): Promise<ProjectContext> {
  throw new Error("not_implemented");
}
