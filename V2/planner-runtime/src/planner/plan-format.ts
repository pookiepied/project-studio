import type { Plan, PlanPhase, PlanStep } from "@studio/v2-contracts";

/**
 * Structured-output contract for the planning loop. The planner drives the
 * exact same ReAct engine as execution (read-only tools to inspect the task),
 * then emits its final answer as a single JSON object matching this shape.
 * We parse that object into a Plan, assigning the server-owned ids.
 */

/** Appended to whatever framing Studio Context (or the fallback) provides. */
export const PLAN_OUTPUT_INSTRUCTION = `
You are producing a structured execution plan. You may use read-only tools to
inspect the task first. When you are ready, output your FINAL answer as a single
JSON object inside a \`\`\`json code fence, and nothing after it. The object MUST
match this shape:

{
  "goal": string,                       // one-line restatement of the objective
  "requirements": string[],             // what must be true / gathered
  "constraints": string[],              // limits the executor must respect
  "risks": string[],                    // what could go wrong
  "dependencies": string[],             // external things this relies on
  "openQuestions": string[],            // unknowns worth surfacing
  "phases": [                           // ordered phases of work
    {
      "title": string,
      "description": string,
      "steps": [
        { "instruction": string, "expectedResources": string[] }
      ]
    }
  ]
}

Do not perform write actions. Produce the plan, not the work.`;

interface RawPlan {
  goal?: string;
  requirements?: string[];
  constraints?: string[];
  risks?: string[];
  dependencies?: string[];
  openQuestions?: string[];
  phases?: Array<{
    title?: string;
    description?: string;
    steps?: Array<{ instruction?: string; expectedResources?: string[] }>;
  }>;
}

/**
 * Parse the loop's final text into a Plan. Throws when no JSON object can be
 * recovered — a plan that cannot be structured is a failed plan, and the
 * engine will surface that rather than store garbage.
 */
export function parsePlan(text: string, goal: string, userId: string): Plan {
  const raw = extractJson(text);
  const now = new Date().toISOString();
  const phases: PlanPhase[] = (raw.phases ?? []).map((phase, pi) => ({
    phaseId: `phase_${pi + 1}`,
    title: phase.title?.trim() || `Phase ${pi + 1}`,
    description: phase.description?.trim() || "",
    steps: (phase.steps ?? []).map(
      (step, si): PlanStep => ({
        stepId: `phase_${pi + 1}_step_${si + 1}`,
        instruction: step.instruction?.trim() || "",
        expectedResources: cleanList(step.expectedResources),
      }),
    ),
  }));
  return {
    planId: crypto.randomUUID(),
    userId,
    goal: raw.goal?.trim() || goal,
    requirements: cleanList(raw.requirements),
    constraints: cleanList(raw.constraints),
    risks: cleanList(raw.risks),
    dependencies: cleanList(raw.dependencies),
    phases,
    openQuestions: cleanList(raw.openQuestions),
    createdAt: now,
  };
}

function extractJson(text: string): RawPlan {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : sliceOutermostObject(text);
  if (!candidate) {
    throw new Error("Planner produced no JSON plan object.");
  }
  try {
    return JSON.parse(candidate.trim()) as RawPlan;
  } catch (error) {
    throw new Error(
      `Planner output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Fallback when the model forgot the fence: take the outermost {...}. */
function sliceOutermostObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : String(item)))
    .filter((item) => item.length > 0);
}
