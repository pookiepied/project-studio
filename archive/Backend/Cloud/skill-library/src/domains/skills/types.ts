export type SkillOwnerType = "system" | "user";
export type SkillStatus = "draft" | "active" | "disabled" | "archived";

export interface SkillOwner {
  type: SkillOwnerType;
  userId?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  status: SkillStatus;
  owner: SkillOwner;
  instructionsRef: string;
  activation: {
    when: string;
    hints: string[];
  };
  requiredTools: string[];
  requiredPermissions: string[];
  resources: string[];
  mcpServerIds: string[];
  metadata: Record<string, unknown>;
}
