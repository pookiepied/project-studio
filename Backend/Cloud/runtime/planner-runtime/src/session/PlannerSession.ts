import {
  RuntimeSession,
  type LoopResult,
  type RegisteredTool,
  type RuntimeProfile,
} from "../runtime/RuntimeSession";
import type { ContextPackage, Plan, RunState } from "../contracts";
import type { Env } from "../system/env";
import { PLAN_OUTPUT_INSTRUCTION, parsePlan } from "../planner/plan-format";

const LATEST_PLAN_KEY = "plan:latest";

/**
 * The Planner Runtime's session: the same durable engine as execution, with
 * three deliberate differences (architecture decision #3 — reuse the engine):
 *
 * - the "planner" consumer profile,
 * - a read-only tool gate (write/destructive capabilities are stripped no
 *   matter what Studio Context exposes), and
 * - a finalize hook that parses the loop's structured output into a Plan,
 *   stores it, and emits it as an artifact.
 *
 * State machine, checkpoints, recovery, streaming, and idempotency are all
 * inherited unchanged from RuntimeSession.
 */
export class PlannerSession extends RuntimeSession<Env> {
  protected readonly profile: RuntimeProfile = {
    consumer: "planner",
    fallbackSystemPrompt:
      "You are Studio Planner Runtime. Produce a clear, structured execution plan. Do not perform write actions.",
  };

  /** Impose the structured-output contract on top of Context's framing. */
  protected override composeSystemPrompt(context: ContextPackage | null): string {
    const base = context?.runtime.systemPrompt ?? this.profile.fallbackSystemPrompt;
    return `${base}\n${PLAN_OUTPUT_INSTRUCTION}`;
  }

  /**
   * Read-only gate: the planner may inspect (read/list/search) but never
   * mutate. Every tool exposed to the loop must pass this gate, regardless of
   * what the context package offered.
   */
  protected override gateTools(
    tools: Record<string, RegisteredTool>,
  ): Record<string, RegisteredTool> {
    const gated: Record<string, RegisteredTool> = {};
    for (const [name, entry] of Object.entries(tools)) {
      if (entry.policy.effect === "none" || entry.policy.effect === "read") {
        gated[name] = entry;
      }
    }
    return gated;
  }

  /**
   * Parse the loop's final text into a Plan and store it. Unlike execution's
   * finalize, this one MAY throw: text that cannot be structured into a plan
   * is a failed attempt, and letting it throw routes into the engine's normal
   * retry/fail path rather than storing garbage.
   */
  protected override async finalize(run: RunState, result: LoopResult): Promise<string> {
    const plan = parsePlan(result.text, run.request, run.userId);
    await this.ctx.storage.put(LATEST_PLAN_KEY, plan);
    try {
      await this.postData("/plans", run.userId, plan);
    } catch (error) {
      await this.emit(run, "run.progress", {
        message: `Studio Data plan persistence failed: ${describe(error)}`,
      });
    }
    await this.emit(run, "artifact.created", {
      artifactId: plan.planId,
      kind: "plan",
      name: plan.goal,
    });
    return JSON.stringify(plan);
  }

  /** Extend the shared HTTP surface with plan retrieval, else delegate. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/plan") {
      const plan = await this.ctx.storage.get<Plan>(LATEST_PLAN_KEY);
      return Response.json(
        plan ? { plan } : { plan: null },
        { status: plan ? 200 : 404 },
      );
    }
    return super.fetch(request);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
