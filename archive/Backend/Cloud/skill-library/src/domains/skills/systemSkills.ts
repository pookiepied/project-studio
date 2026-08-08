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

const systemSkillContent: Record<string, string> = {
  "product-self-knowledge": `---
name: Product Self-Knowledge
description: Use when an agent needs a concise, current understanding of Studio's product identity and cloud/local architecture.
---

# Product Self-Knowledge

Studio is an AI workspace built by pookiepied for cloud-local agent workflows, software work, research, and tool-assisted execution.
The cloud system is being split into focused Workers instead of one overloaded chat worker.
Gateway owns model-provider routing; runtimes own agent loops; Context Engine assembles relevant resources; Data owns user content and artifacts.
The Cloud Library Registry stores searchable registrations for system and future user-scoped skills, MCP servers, and agents.
The Agent, Skill, and MCP Libraries store full definitions for those resource types while the registry keeps metadata and references.
Memory and native tools are first-party platform services, not ordinary discoverable MCP library entries.
Cloud resources are system-managed first, but registry and library schemas are designed for future user-scoped resources with strict isolation.
Do not claim a Studio feature is live unless it is verified in the current codebase or current runtime.
`,
};

export function readSystemSkillContent(skillId: string): string | undefined {
  return systemSkillContent[skillId];
}
