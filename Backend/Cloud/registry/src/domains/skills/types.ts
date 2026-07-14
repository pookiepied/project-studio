import type { ResourceOwner, ResourceOwnerType } from "../../system/ownership";

export const skillStatuses = ["draft", "active", "disabled", "archived"] as const;
export const skillOrigins = ["studio", "third-party"] as const;

export type SkillStatus = (typeof skillStatuses)[number];
export type SkillOrigin = (typeof skillOrigins)[number];

export interface SkillRecord extends ResourceOwner {
  id: string;
  name: string;
  slug: string;
  description: string;
  origin: SkillOrigin;
  status: SkillStatus;
  currentVersion: string;
  instructionsRef: string;
  configRef?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  activationRules: Record<string, unknown>;
  requiredTools: string[];
  requiredPermissions: string[];
  resources: unknown[];
  mcpServerIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillSearch {
  userId: string;
  query?: string;
  status?: SkillStatus;
  origin?: SkillOrigin;
  ownerType?: ResourceOwnerType;
  tag?: string;
  limit: number;
}
