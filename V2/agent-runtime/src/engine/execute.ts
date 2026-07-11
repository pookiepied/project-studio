import type {
  AgentDefinition,
  DelegationRequest,
  DelegationResult,
} from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Configuration layer over the shared execution engine (open decision #3).
 * This module translates an AgentDefinition + scoped request into an engine
 * configuration (model, prompt, permitted tools, limits) — it must not grow
 * into a second loop implementation.
 */

export async function executeAgent(
  _env: Env,
  _definition: AgentDefinition,
  _request: DelegationRequest,
): Promise<DelegationResult> {
  throw new Error("not_implemented");
}
