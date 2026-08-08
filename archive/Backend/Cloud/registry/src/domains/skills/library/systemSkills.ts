import type { SkillRecord } from "../types";

export const systemSkillRegistrations: SkillRecord[] = [
  {
    id: "product-self-knowledge",
    ownerType: "system",
    ownerKey: "system",
    name: "Product Self-Knowledge",
    slug: "product-self-knowledge",
    description: "Concise current overview of Studio's product identity and cloud/local architecture.",
    origin: "studio",
    status: "active",
    currentVersion: "0.1.0",
    instructionsRef: "bundled://skill-library/skills/product-self-knowledge/SKILL.md",
    configRef: "bundled://skill-library/templates/skill-definition.template.json",
    tags: ["studio", "product", "architecture"],
    metadata: {
      library: "studio-cloud-skill-library",
      format: "anthropic-skill",
      bundled: true,
    },
    activationRules: {
      when: "Use when an agent needs product or architecture self-knowledge about Studio.",
      hints: ["Studio architecture", "product identity", "cloud local split"],
    },
    requiredTools: [],
    requiredPermissions: [],
    resources: [],
    mcpServerIds: [],
    createdAt: "",
    updatedAt: "",
  },
];

export function listSystemSkillRegistrations(): SkillRecord[] {
  return systemSkillRegistrations;
}
