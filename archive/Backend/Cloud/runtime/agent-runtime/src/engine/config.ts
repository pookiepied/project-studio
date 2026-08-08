import type {
  AgentDefinition,
  AgentLimits,
  AgentPermissions,
  ExecutionLimits,
} from "../contracts";

/**
 * Pure translation from an AgentDefinition and delegation request into local
 * runtime inputs. This is not a second loop; it computes model, prompt framing,
 * tool permissions, and limits for this worker's RuntimeSession.
 */

/** Maps AgentLimits (agent vocabulary) into ExecutionLimits (runtime vocabulary). */
export function mapAgentLimits(limits: AgentLimits | undefined): ExecutionLimits {
  const mapped: ExecutionLimits = {};
  if (limits?.maxSteps !== undefined) mapped.maxModelSteps = limits.maxSteps;
  if (limits?.maxDurationMs !== undefined) mapped.maxWallClockMs = limits.maxDurationMs;
  if (limits?.maxTokens !== undefined) mapped.maxTotalTokens = limits.maxTokens;
  return mapped;
}

/**
 * A delegated invocation may only ever narrow an agent's own permissions, never
 * widen them. Booleans AND together; the tool allowlist intersects.
 */
export function narrowPermissions(
  base: AgentPermissions,
  override: Partial<AgentPermissions> | undefined,
): AgentPermissions {
  if (!override) return base;
  return {
    read: base.read && (override.read ?? true),
    write: base.write && (override.write ?? true),
    delegation: base.delegation && (override.delegation ?? true),
    tools: intersectOrKeep(base.tools, override.tools),
    allowedConnectors: intersectOrKeep(base.allowedConnectors, override.allowedConnectors),
    allowedMcpServers: intersectOrKeep(base.allowedMcpServers, override.allowedMcpServers),
    allowedSkills: intersectOrKeep(base.allowedSkills, override.allowedSkills),
  };
}

/** Take the tighter of two optional limit sets. Smaller values win. */
export function narrowLimits(
  base: ExecutionLimits,
  override: ExecutionLimits | undefined,
): ExecutionLimits {
  if (!override) return base;
  const keys = new Set([...Object.keys(base), ...Object.keys(override)]) as Set<keyof ExecutionLimits>;
  const result: ExecutionLimits = {};
  for (const key of keys) {
    const a = base[key];
    const b = override[key];
    const tighter = a === undefined ? b : b === undefined ? a : Math.min(a, b);
    if (tighter !== undefined) result[key] = tighter;
  }
  return result;
}

/**
 * Resolve the AgentDefinition to run. Preference order:
 * 1. an inline definition supplied by the caller;
 * 2. Studio Registry's `/agents/:id`.
 */
export async function resolveDefinition(
  registry: Fetcher,
  agentId: string,
  userId: string,
  inline: AgentDefinition | undefined,
): Promise<AgentDefinition | null> {
  if (inline) return inline;
  const response = await registry.fetch(`https://registry/agents/${encodeURIComponent(agentId)}`, {
    headers: { "x-user-id": userId },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { agent?: AgentDefinition } | AgentDefinition;
  return "agent" in body ? (body.agent ?? null) : (body as AgentDefinition);
}

function intersectOrKeep(base: string[], override: string[] | undefined): string[] {
  if (override === undefined) return base;
  const allowed = new Set(base);
  return override.filter((item) => allowed.has(item));
}
