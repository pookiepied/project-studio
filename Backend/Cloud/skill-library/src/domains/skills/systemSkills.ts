import type { SkillDefinition } from "./types";

export const systemSkillDefinitions: SkillDefinition[] = [
  {
    id: "product-self-knowledge",
    name: "Product Self-Knowledge",
    slug: "product-self-knowledge",
    description: "Concise current overview of Studio's product identity and cloud/local architecture.",
    version: "0.1.0",
    status: "active",
    owner: { type: "system" },
    instructionsRef: "bundled://skill-library/skills/product-self-knowledge/SKILL.md",
    activation: {
      when: "Use when an agent needs a compact, current understanding of what Studio is and how its major systems are separated.",
      hints: ["Studio architecture", "product identity", "cloud local split", "registry libraries"],
    },
    requiredTools: [],
    requiredPermissions: [],
    resources: [],
    mcpServerIds: [],
    metadata: {
      format: "anthropic-skill",
      bundled: true,
    },
  },
];

export function listSystemSkillDefinitions(): SkillDefinition[] {
  return systemSkillDefinitions;
}
