import {
  RuntimeSession,
  type LoopResult,
  type RegisteredTool,
  type RuntimeProfile,
} from "../runtime/RuntimeSession";
import type {
  AgentDefinition,
  ContextPackage,
  DelegationResult,
  RunState,
} from "../contracts";
import type { Env } from "../system/env";

const DEFINITION_KEY = "agent:definition";
const RESULT_KEY = "agent:result";

/**
 * The Agent Runtime's session: the same durable engine as execution and
 * planning, configured by an AgentDefinition instead of a fixed profile
 * over this worker's local base runtime session.
 *
 * The invoke route resolves the effective definition (Registry or inline,
 * with delegation permissions already narrowed) and hands it to `/start`;
 * this session persists it durably so it survives eviction/recovery, then
 * specializes the engine from it:
 *
 * - `composeSystemPrompt`: the agent's own prompt/personality/output format,
 * - `gateTools`: the agent's permission allowlist plus read/write gate,
 * - `finalize`: store a DelegationResult for the caller to fetch.
 *
 * Limits and model come through the normal engine inputs (mapped by the route).
 */
export class AgentSession extends RuntimeSession<Env> {
  protected readonly profile: RuntimeProfile = {
    consumer: "agent",
    fallbackSystemPrompt:
      "You are a Studio agent. Follow your definition and the scoped task; do only what your permissions allow.",
  };

  /** Hydrated from durable storage before every attempt (incl. recovery). */
  private definition: AgentDefinition | null = null;

  protected override async beforeExecute(): Promise<void> {
    this.definition = (await this.ctx.storage.get<AgentDefinition>(DEFINITION_KEY)) ?? null;
  }

  /** The agent definition is the identity. It supersedes Context Engine framing. */
  protected override composeSystemPrompt(context: ContextPackage | null): string {
    const def = this.definition;
    if (!def) return super.composeSystemPrompt(context);
    const parts = [def.systemPrompt];
    if (def.personality) parts.push(`Personality: ${def.personality}`);
    if (def.outputFormat === "json" || def.outputFormat === "structured") {
      parts.push("Provide your final answer as a single JSON object.");
    }
    return parts.join("\n\n");
  }

  /**
   * Permission gate: an agent may use only the effects its definition grants
   * and, when the definition names an explicit tool allowlist, only those
   * tools. Everything Studio Context Engine exposes is filtered through this.
   */
  protected override gateTools(
    tools: Record<string, RegisteredTool>,
  ): Record<string, RegisteredTool> {
    const def = this.definition;
    if (!def) return {}; // No resolved definition means no tools (fail safe).
    const allow = new Set(def.permissions.tools);
    const restrictToAllowlist = allow.size > 0;
    const gated: Record<string, RegisteredTool> = {};
    for (const [name, entry] of Object.entries(tools)) {
      const effect = entry.policy.effect;
      if ((effect === "write" || effect === "destructive") && !def.permissions.write) continue;
      if (effect === "read" && !def.permissions.read) continue;
      if (restrictToAllowlist && !allow.has(name)) continue;
      gated[name] = entry;
    }
    return gated;
  }

  /** Store the agent's structured result for the caller/parent to retrieve. */
  protected override async finalize(run: RunState, result: LoopResult): Promise<string> {
    const delegationResult: DelegationResult = {
      agentId: this.definition?.id ?? "unknown",
      status: "completed",
      output: result.text,
    };
    await this.ctx.storage.put(RESULT_KEY, delegationResult);
    await this.emit(run, "artifact.created", {
      artifactId: run.runId,
      kind: "agent_result",
      name: this.definition?.name ?? "agent output",
    });
    return result.text;
  }

  /**
   * Extend the base surface: intercept `/start` to persist the definition
   * out of the body, and serve `/result`. Everything else delegates to the
   * engine's HTTP surface unchanged.
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/start") {
      const body = (await request.json()) as Record<string, unknown> & {
        agentDefinition?: AgentDefinition;
      };
      const { agentDefinition, ...startBody } = body;
      if (agentDefinition) await this.ctx.storage.put(DEFINITION_KEY, agentDefinition);
      return super.fetch(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(startBody),
        }),
      );
    }
    if (request.method === "GET" && url.pathname === "/result") {
      const result = await this.ctx.storage.get<DelegationResult>(RESULT_KEY);
      return Response.json(
        result ? { result } : { result: null },
        { status: result ? 200 : 404 },
      );
    }
    return super.fetch(request);
  }
}
