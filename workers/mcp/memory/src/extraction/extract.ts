import type { Env } from "../env";
import type { Category, SourceType, DecayRate } from "../db/types";

export interface ExtractedMemory {
  summary: string;
  keyPoints: string[];
  facts: Array<{
    content: string;
    category: Category;
    tags: string[];
    importance: number;
    source_type: SourceType;
    decay_rate: DecayRate;
  }>;
  entities: string[];
  relations: Array<{
    entityA: string;
    relation: string;
    entityB: string;
  }>;
  topics: string[];
  participants: string[];
  overallImportance: number;
}

const SYSTEM_PROMPT = `You are a memory extraction system for STUDIO. Analyze conversations and extract structured knowledge.

Output ONLY valid JSON — no prose, no markdown fences:
{
  "summary": "2-3 sentence summary of what happened in this conversation",
  "keyPoints": ["self-contained fact 1", "self-contained fact 2"],
  "facts": [
    {
      "content": "single clear self-contained sentence",
      "category": "identity|preference|project|event|knowledge",
      "tags": ["tag1", "tag2"],
      "importance": 7,
      "source_type": "stated|inferred|observed",
      "decay_rate": "none|slow|medium|fast"
    }
  ],
  "entities": ["Person Name", "Project Name", "Tool Name", "Concept"],
  "relations": [
    { "entityA": "User", "relation": "works_on", "entityB": "Studio" }
  ],
  "topics": ["topic1", "topic2"],
  "participants": ["names of people mentioned other than the user"],
  "overallImportance": 6
}

Categories:
- identity:   who the user is (name, role, location, background facts)
- preference: what they like/dislike, work style, communication preferences, habits
- project:    ongoing work, current goals, tech decisions, active tasks
- event:      things that happened (built X, shipped Y, had a meeting about Z)
- knowledge:  skills, domain expertise, facts the user knows or has learned

source_type:
- stated:   user explicitly said this fact
- inferred: extracted from context — not said directly but clearly implied
- observed: a behavioral pattern visible in how the user communicates or works

decay_rate:
- none:   permanent facts that will always be relevant (name, core role, identity)
- slow:   stable over months (skills, strong long-term preferences)
- medium: relevant for weeks (current project state, active goals)
- fast:   relevant for days only (transient context, temporary state)

Importance 1-10. Only extract facts that would genuinely help future conversations.
Tags: 2-4 lowercase keywords per fact.
Relations use verb phrases: works_on, uses, knows, decided_to, prefers, built, etc.`;

export async function extractFromConversation(
  env: Env,
  messages: Array<{ role: string; content: unknown }>
): Promise<ExtractedMemory | null> {
  const conversationText = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role === "user" ? "User" : "Assistant"}: ${content}`;
    })
    .join("\n\n");

  if (!conversationText.trim()) return null;

  try {
    const response = await env.AI_WORKER.fetch(
      new Request("http://internal/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:      env.EXTRACT_MODEL,
          max_tokens: 1500,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role:    "user",
              content: `Extract memory from this conversation:\n\n${conversationText}`,
            },
          ],
        }),
      })
    );

    if (!response.ok) return null;

    const data = await response.json<{
      choices: Array<{ message: { content: string } }>;
    }>();
    const text = data.choices?.[0]?.message?.content ?? "";

    const stripped   = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const jsonMatch  = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[memory/extract] No JSON object found in model response:", text.slice(0, 200));
      return null;
    }

    return JSON.parse(jsonMatch[0]) as ExtractedMemory;
  } catch (err) {
    console.error("[memory/extract] Failed to parse extraction response:", err);
    return null;
  }
}
