import type { ChatEngine } from "@/cliBridges/types";

/**
 * Canonical permission-mode identifiers, shared by every engine.
 *
 * These mirror Anthropic's Claude Code permission model - the most complete
 * one we support today. Engines that support fewer modes (e.g. Studio AI, which
 * today only distinguishes "ask before sensitive actions" from "act
 * autonomously") simply opt into a subset via `PermissionModeDef.engines`.
 *
 * Values match what `claude --permission-mode <value>` accepts so the Claude
 * bridge can pass the id straight through.
 */
export type PermissionModeId =
  | "default"          // Ask before sensitive actions
  | "acceptEdits"      // Auto-approve file edits, ask for the rest
  | "plan"             // Plan only - no execution
  | "bypassPermissions"; // Full autonomy

export type PermissionIconKey = "eye" | "pencil" | "compass" | "shield";

export interface PermissionModeDef {
  id: PermissionModeId;
  label: string;
  description: string;
  icon: PermissionIconKey;
  /** Which engines expose this mode in their UI. */
  engines: ChatEngine[];
}
