import type { SkillSummary } from "../types";

/**
 * Build the prompt-ready skills index text injected into the system prompt's
 * `Available Skills` section.
 *
 * Format is deliberately identical to the previous chat-local index so model
 * behavior is preserved:
 *   - **{key}** [{category}]: {description}
 *
 * Shadowed duplicate skills are omitted from the prompt index (they would
 * only confuse the model) but remain available in /list responses for UI/debug.
 */
export function buildSkillIndex(skills: SkillSummary[]): string {
  return skills
    .filter((s) => !s.shadowedBy)
    .map((s) => `- **${s.key}** [${s.category}]: ${s.description}`)
    .join("\n");
}
