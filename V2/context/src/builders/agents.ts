import type { AgentContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Agent layer (§19.5): specialized agents available for delegation, with
 * descriptions, permissions, and execution locations.
 */
export async function buildAgentContext(
  _env: Env,
  _userId: string,
  _task: string,
): Promise<AgentContext[]> {
  throw new Error("not_implemented");
}
