/**
 * ============================================================================
 * DEMO: Planning + Reflection Agent Pattern
 * ============================================================================
 *
 * This is a STANDALONE DEMO. It does NOT import from or modify any existing
 * code in this project. It demonstrates a pattern that could be added as a
 * NEW module on top of the existing agent loop.
 *
 * The existing while(true) loop in loop.ts / runner.ts stays untouched.
 * This would be an OPTIONAL wrapper that adds planning intelligence.
 * ============================================================================
 */

// ============================================================================
// Types (self-contained, no imports from the project)
// ============================================================================

interface Step {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  toolCalls?: ToolCallResult[];
  output?: string;
  error?: string;
  dependsOn?: string[];  // step IDs this depends on
  retries: number;
  maxRetries: number;
}

interface Plan {
  goal: string;
  steps: Step[];
  currentStepIndex: number;
  context: string[];          // accumulated findings
  qualityChecks: string[];    // what must be true before completion
  completedAt?: number;
  failedAt?: number;
}

interface ToolCallResult {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
  success: boolean;
  durationMs: number;
}

interface Reflection {
  shouldContinue: boolean;
  shouldReplan: boolean;
  shouldRetry: boolean;
  qualityPassed: boolean;
  reasoning: string;
  adjustment?: string;        // what to change in the plan
  contextAddition?: string;   // new finding to remember
}

interface LLMResponse {
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
  }[];
}

// ============================================================================
// The Agent Brain (replaces the raw while(true) with a state machine)
// ============================================================================

class PlanningAgent {
  private maxReplans = 3;
  private maxStepsPerPlan = 20;

  /**
   * Main entry point. Instead of a raw while(true), this orchestrates:
   *   PLAN → EXECUTE → REFLECT → (replan if needed) → VERIFY → DONE
   */
  async run(
    task: string,
    tools: ToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<string> {

    let plan = await this.createPlan(task, callLLM);
    let replanCount = 0;

    console.log(`\n📋 PLAN CREATED (${plan.steps.length} steps):`);
    plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.description}`));
    console.log('');

    // ── Main orchestration loop ────────────────────────────────────────
    while (!this.isPlanComplete(plan)) {
      const step = this.getNextStep(plan);
      if (!step) break;

      console.log(`\n🔄 Step: ${step.description}`);

      // ── Execute the step ─────────────────────────────────────────────
      step.status = "in_progress";
      const stepResult = await this.executeStep(step, tools, executeTool, callLLM);
      step.toolCalls = stepResult.toolCalls;
      step.output = stepResult.output;

      if (stepResult.success) {
        step.status = "completed";
        console.log(`  ✅ Completed`);
      } else {
        step.status = "failed";
        step.error = stepResult.error;
        console.log(`  ❌ Failed: ${stepResult.error}`);
      }

      // ── Reflect on what happened ─────────────────────────────────────
      const reflection = await this.reflect(plan, step, callLLM);

      console.log(`  🪞 Reflection: ${reflection.reasoning}`);

      if (reflection.contextAddition) {
        plan.context.push(reflection.contextAddition);
        console.log(`  📝 New context: ${reflection.contextAddition.slice(0, 80)}...`);
      }

      // ── Decide what to do next ───────────────────────────────────────
      if (reflection.shouldRetry && step.retries < step.maxRetries) {
        step.retries++;
        step.status = "pending";
        console.log(`  🔁 Retrying (${step.retries}/${step.maxRetries})`);
        continue;
      }

      if (reflection.shouldReplan && replanCount < this.maxReplans) {
        plan = await this.replan(plan, step, reflection, callLLM);
        replanCount++;
        console.log(`  🔄 Replanned (${replanCount}/${this.maxReplans})`);
        console.log(`  📋 New plan (${plan.steps.length} steps):`);
        plan.steps.forEach((s, i) => {
          const marker = s.status === "completed" ? "✅" : s.status === "failed" ? "❌" : "⬜";
          console.log(`    ${marker} ${i + 1}. ${s.description}`);
        });
        console.log('');
        continue;
      }

      if (!reflection.shouldContinue) {
        console.log(`  🛑 Agent decided to stop: ${reflection.reasoning}`);
        break;
      }
    }

    // ── Final verification ─────────────────────────────────────────────
    const verified = await this.verify(plan, callLLM);
    if (!verified.passed) {
      console.log(`\n⚠️  Verification failed: ${verified.reasoning}`);
      console.log(`  Attempting final fix...`);
      // Could do one more fix cycle here
    }

    // ── Synthesize final answer ────────────────────────────────────────
    const answer = await this.synthesize(plan, callLLM);
    console.log(`\n✨ DONE (${plan.steps.filter(s => s.status === "completed").length}/${plan.steps.length} steps completed)\n`);
    return answer;
  }

  // ====================================================================
  // PLAN: Create an initial plan from the task
  // ====================================================================

  private async createPlan(
    task: string,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<Plan> {

    const response = await callLLM([
      {
        role: "system",
        content: `You are a planning agent. Given a task, break it into concrete steps.

Return a JSON plan with this structure:
{
  "steps": [
    { "description": "what to do", "toolNeeded": "tool_name or null", "dependsOn": [] }
  ],
  "qualityChecks": ["what must be true before declaring success"]
}

Rules:
- Each step should be ONE atomic action
- Order steps by dependency (things that don't depend on others come first)
- Include verification steps (run tests, check diff, etc.)
- Be specific: "read src/auth.ts" not "read relevant files"
- Maximum 15 steps`
      },
      {
        role: "user",
        content: task,
      }
    ]);

    // Parse the LLM's plan (in practice, you'd use structured output or JSON mode)
    const planText = response.content;
    const steps = this.parsePlanSteps(planText, task);
    const qualityChecks = this.parseQualityChecks(planText);

    return {
      goal: task,
      steps,
      currentStepIndex: 0,
      context: [],
      qualityChecks,
    };
  }

  // ====================================================================
  // EXECUTE: Run a single step
  // ====================================================================

  private async executeStep(
    step: Step,
    tools: ToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<{ success: boolean; output: string; toolCalls: ToolCallResult[]; error?: string }> {

    const toolCalls: ToolCallResult[] = [];
    const startTime = Date.now();

    // Ask the LLM what tool calls to make for this step
    const response = await callLLM([
      {
        role: "system",
        content: `You are executing a specific step in a plan. Current step: "${step.description}"

Available tools: ${tools.map(t => t.name).join(", ")}

Your job: make the RIGHT tool calls for this step. Do NOT do extra work.
If this step needs information from previous steps, check the context.

Return your tool calls as JSON: { "toolCalls": [{ "name": "...", "args": {...} }] }
If no tool calls are needed (step is already done or just needs reasoning), return your output text.`
      },
      {
        role: "user",
        content: `Step: ${step.description}\n\nContext so far:\n${step.dependsOn?.join("\n") ?? "None"}`,
      }
    ]);

    // Execute tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Execute in parallel (like current system) but with timeout per tool
      const results = await Promise.all(
        response.toolCalls.map(async (tc) => {
          const args = JSON.parse(tc.arguments || "{}");
          const toolStart = Date.now();
          try {
            const output = await Promise.race([
              executeTool(tc.name, args),
              this.timeout(30_000), // 30s per tool
            ]);
            const duration = Date.now() - toolStart;
            return {
              toolName: tc.name,
              args,
              output: output as string,
              success: true,
              durationMs: duration,
            };
          } catch (err) {
            const duration = Date.now() - toolStart;
            return {
              toolName: tc.name,
              args,
              output: `Error: ${err instanceof Error ? err.message : String(err)}`,
              success: false,
              durationMs: duration,
            };
          }
        })
      );

      toolCalls.push(...results);

      // Check if ALL tool calls failed
      const allFailed = results.every(r => !r.success);
      if (allFailed) {
        return {
          success: false,
          output: results.map(r => r.output).join("\n"),
          toolCalls,
          error: `All ${results.length} tool calls failed`,
        };
      }

      // Return combined output
      return {
        success: true,
        output: results.map(r => `[${r.toolName}] ${r.output}`).join("\n\n"),
        toolCalls,
      };
    }

    // No tool calls — step was purely reasoning
    return {
      success: true,
      output: response.content,
      toolCalls,
    };
  }

  // ====================================================================
  // REFLECT: Evaluate what happened and decide next action
  // ====================================================================

  private async reflect(
    plan: Plan,
    completedStep: Step,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<Reflection> {

    const completedSteps = plan.steps.filter(s => s.status === "completed");
    const failedSteps = plan.steps.filter(s => s.status === "failed");

    const response = await callLLM([
      {
        role: "system",
        content: `You are a reflection agent. Evaluate the result of a step in a plan.

The plan goal: ${plan.goal}
Completed steps: ${completedSteps.map(s => s.description).join(", ") || "none"}
Failed steps: ${failedSteps.map(s => `${s.description} (${s.error})`).join(", ") || "none"}
Current step just completed: "${completedStep.description}"
Step output: ${completedStep.output?.slice(0, 500) ?? "no output"}
Step error: ${completedStep.error ?? "none"}
Quality checks: ${plan.qualityChecks.join(", ")}

Respond with JSON:
{
  "shouldContinue": true/false,
  "shouldReplan": true/false,
  "shouldRetry": true/false,
  "qualityPassed": true/false,
  "reasoning": "why you made this decision",
  "adjustment": "what to change if replanning" or null,
  "contextAddition": "new finding to remember" or null
}

Think carefully:
- Did this step achieve its goal?
- Is the overall plan still on track?
- Should we continue, replan, retry, or stop?
- What did we learn that the next steps need to know?`
      },
      {
        role: "user",
        content: `Evaluate step "${completedStep.description}" and decide what to do next.`,
      }
    ]);

    return this.parseReflection(response.content);
  }

  // ====================================================================
  // REPLAN: Create a new plan based on what we learned
  // ====================================================================

  private async replan(
    currentPlan: Plan,
    failedStep: Step,
    reflection: Reflection,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<Plan> {

    const completedSteps = currentPlan.steps.filter(s => s.status === "completed");

    const response = await callLLM([
      {
        role: "system",
        content: `You need to create a new plan because something changed.

Original goal: ${currentPlan.goal}
What we've completed so far:
${completedSteps.map(s => `- ✅ ${s.description}`).join("\n") || "(nothing yet)"}

What failed: "${failedStep.description}" — ${failedStep.error}
Why we're replanning: ${reflection.reasoning}
Adjustment needed: ${reflection.adjustment}

Context learned:
${currentPlan.context.join("\n") || "(none)"}

Create a new plan. Keep completed steps. Skip or replace failed steps.
Maximum 15 steps. Return JSON like before.`
      },
      {
        role: "user",
        content: "Create the updated plan.",
      }
    ]);

    const steps = this.parsePlanSteps(response.content, currentPlan.goal);
    const qualityChecks = this.parseQualityChecks(response.content);

    // Mark previously completed steps
    const completedDescriptions = new Set(completedSteps.map(s => s.description));
    for (const step of steps) {
      if (completedDescriptions.has(step.description)) {
        step.status = "completed";
      }
    }

    return {
      goal: currentPlan.goal,
      steps,
      currentStepIndex: 0,
      context: [...currentPlan.context, reflection.contextAddition].filter(Boolean) as string[],
      qualityChecks,
    };
  }

  // ====================================================================
  // VERIFY: Final quality check before declaring done
  // ====================================================================

  private async verify(
    plan: Plan,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<{ passed: boolean; reasoning: string }> {

    const response = await callLLM([
      {
        role: "system",
        content: `Verify that a plan has been completed successfully.

Goal: ${plan.goal}
Quality checks: ${plan.qualityChecks.join(", ")}
Steps completed: ${plan.steps.filter(s => s.status === "completed").map(s => s.description).join(", ")}
Steps failed: ${plan.steps.filter(s => s.status === "failed").map(s => `${s.description} (${s.error})`).join(", ") || "none"}
Context: ${plan.context.join("\n")}

Check:
1. Were all quality checks met?
2. Were all critical steps completed?
3. Are there any obvious gaps?

Return JSON: { "passed": true/false, "reasoning": "..." }`
      },
      {
        role: "user",
        content: "Verify completion.",
      }
    ]);

    return this.parseVerification(response.content);
  }

  // ====================================================================
  // SYNTHESIZE: Produce the final answer
  // ====================================================================

  private async synthesize(
    plan: Plan,
    callLLM: (messages: Message[]) => Promise<LLMResponse>,
  ): Promise<string> {

    const response = await callLLM([
      {
        role: "system",
        content: `Synthesize a final answer based on completed work.

Goal: ${plan.goal}
Completed steps and their outputs:
${plan.steps
  .filter(s => s.status === "completed")
  .map(s => `- ${s.description}\n  Output: ${s.output?.slice(0, 300) ?? "(no output)"}`)
  .join("\n\n")}

Context learned:
${plan.context.join("\n")}

Write a clear, complete answer that addresses the original goal.
Include specific details from the tool outputs (file paths, code snippets, test results, etc.).`
      },
      {
        role: "user",
        content: "Synthesize the final answer.",
      }
    ]);

    return response.content;
  }

  // ====================================================================
  // Helpers
  // ====================================================================

  private isPlanComplete(plan: Plan): boolean {
    return plan.steps.every(s =>
      s.status === "completed" || s.status === "skipped"
    );
  }

  private getNextStep(plan: Plan): Step | null {
    for (let i = plan.currentStepIndex; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (step.status === "pending") {
        // Check dependencies
        const depsMet = (step.dependsOn ?? []).every(depId =>
          plan.steps.find(s => s.id === depId)?.status === "completed"
        );
        if (depsMet) {
          plan.currentStepIndex = i;
          return step;
        }
      }
    }
    return null;
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timeout after ${ms}ms`)), ms)
    );
  }

  // ── Parsers (in production, use structured output / JSON mode) ──────

  private parsePlanSteps(llmOutput: string, task: string): Step[] {
    try {
      const json = JSON.parse(llmOutput);
      return (json.steps ?? []).map((s: any, i: number) => ({
        id: `step-${i}`,
        description: s.description || `Step ${i + 1}`,
        status: "pending" as const,
        dependsOn: s.dependsOn ?? [],
        retries: 0,
        maxRetries: 2,
      }));
    } catch {
      // Fallback: create a single step with the whole task
      return [{
        id: "step-0",
        description: task,
        status: "pending",
        retries: 0,
        maxRetries: 2,
      }];
    }
  }

  private parseQualityChecks(llmOutput: string): string[] {
    try {
      const json = JSON.parse(llmOutput);
      return json.qualityChecks ?? [];
    } catch {
      return [];
    }
  }

  private parseReflection(llmOutput: string): Reflection {
    try {
      const json = JSON.parse(llmOutput);
      return {
        shouldContinue: json.shouldContinue ?? true,
        shouldReplan: json.shouldReplan ?? false,
        shouldRetry: json.shouldRetry ?? false,
        qualityPassed: json.qualityPassed ?? true,
        reasoning: json.reasoning ?? "No reasoning provided",
        adjustment: json.adjustment ?? undefined,
        contextAddition: json.contextAddition ?? undefined,
      };
    } catch {
      return {
        shouldContinue: true,
        shouldReplan: false,
        shouldRetry: false,
        qualityPassed: true,
        reasoning: "Reflection parse failed, continuing by default",
      };
    }
  }

  private parseVerification(llmOutput: string): { passed: boolean; reasoning: string } {
    try {
      const json = JSON.parse(llmOutput);
      return {
        passed: json.passed ?? true,
        reasoning: json.reasoning ?? "No reasoning",
      };
    } catch {
      return { passed: true, reasoning: "Verification parse failed" };
    }
  }
}

// ============================================================================
// Types needed by the agent (matching existing project types loosely)
// ============================================================================

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

// ============================================================================
// DEMO: How this would integrate with the existing system
// ============================================================================

/**
 * THIS SECTION IS A DEMONSTRATION ONLY.
 * It shows how the PlanningAgent would wrap the existing agent loop.
 *
 * In practice, this would be a NEW file in:
 *   chat/src/orchestration/agent/planningLoop.ts
 *
 * It would call the EXISTING:
 *   - runLlmStep() from nodes/llm.ts
 *   - runToolsStep() from nodes/tools.ts
 *   - ToolRegistry from tools/index.ts
 *
 * WITHOUT modifying any of those files.
 */

async function demoIntegration() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  DEMO: Planning Agent Integration');
  console.log('═══════════════════════════════════════════════════════\n');

  // This is a MOCK — in reality these would call your existing code
  const mockCallLLM = async (messages: Message[]): Promise<LLMResponse> => {
    // In production: this calls runLlmStep() from nodes/llm.ts
    // Which calls GatewayAdapter.streamFull() or complete()
    console.log(`  [LLM] Called with ${messages.length} messages`);
    return {
      content: "Mock response",
      toolCalls: [],
    };
  };

  const mockExecuteTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    // In production: this calls registry.execute() from tools/index.ts
    console.log(`  [TOOL] ${name}(${JSON.stringify(args).slice(0, 60)}...)`);
    return `Mock result for ${name}`;
  };

  const mockTools: ToolDefinition[] = [
    { name: "read_file", description: "Read a file", parameters: {} },
    { name: "edit_file", description: "Edit a file", parameters: {} },
    { name: "bash", description: "Run a command", parameters: {} },
    { name: "grep", description: "Search content", parameters: {} },
  ];

  const agent = new PlanningAgent();
  const result = await agent.run(
    "Add email validation to the auth middleware",
    mockTools,
    mockExecuteTool,
    mockCallLLM,
  );

  console.log('Result:', result);
}

// ============================================================================
// COMPARISON: Current loop vs Planning loop
// ============================================================================

/**
 * CURRENT (loop.ts):
 * ────────────────────
 * while (true) {
 *   response = callLLM(messages, tools)
 *   if (no tool_calls) return response.content
 *   results = executeTools(response.tool_calls)
 *   messages.push(response, ...results)
 * }
 *
 * Problems:
 *   - No plan, no progress tracking
 *   - No reflection (did the tool output help?)
 *   - No error recovery (tool fails → error goes to LLM → LLM may ignore it)
 *   - No context management (history grows unbounded)
 *   - No quality gate (LLM decides it's done based on vibes)
 *
 *
 * PLANNING (this demo):
 * ─────────────────────
 * plan = await createPlan(task)
 * while (!planComplete(plan)) {
 *   step = getNextStep(plan)
 *   result = await executeStep(step)      // uses existing tools
 *   reflection = await reflect(result)    // NEW: evaluate progress
 *   if (reflection.shouldReplan) {
 *     plan = await replan(plan)           // NEW: adjust strategy
 *   }
 * }
 * await verify(plan)                      // NEW: quality gate
 * return await synthesize(plan)           // NEW: structured output
 *
 * Benefits:
 *   - Explicit plan with tracked steps
 *   - Reflection catches failures early
 *   - Replanning adapts to unexpected results
 *   - Verification ensures quality before completion
 *   - Context is managed (only relevant findings carried forward)
 */

// Run the demo
// demoIntegration();
