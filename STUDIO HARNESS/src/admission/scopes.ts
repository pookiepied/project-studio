import type { AuthContext } from "./context.js";

export const ADMISSION_SCOPES = {
  AGENT_RUN: "agent:run",
  EXTENSION_MANAGEMENT: "extension-management",
  APPROVAL: "approval",
  PROJECT: "project",
  DIAGNOSTIC: "diagnostic",
} as const;

export type AdmissionScope =
  (typeof ADMISSION_SCOPES)[keyof typeof ADMISSION_SCOPES];

export const ALL_ADMISSION_SCOPES: readonly AdmissionScope[] = Object.freeze([
  ADMISSION_SCOPES.AGENT_RUN,
  ADMISSION_SCOPES.EXTENSION_MANAGEMENT,
  ADMISSION_SCOPES.APPROVAL,
  ADMISSION_SCOPES.PROJECT,
  ADMISSION_SCOPES.DIAGNOSTIC,
]);

export function hasAdmissionScope(
  context: AuthContext,
  scope: AdmissionScope,
): boolean {
  return context.scopes.includes(scope);
}
