import type { ChatEngine } from "../cliBridges/types";
import type { PermissionModeDef, PermissionModeId } from "./types";

/**
 * Centralized permission-mode catalog.
 *
 * One source of truth shared across engines so the UI, the Claude CLI bridge,
 * and any future CLI bridge all speak the same language. Add a new engine to a
 * mode's `engines` array to expose it there - no per-engine duplication.
 */
export const PERMISSION_MODES: PermissionModeDef[] = [
  {
    id: "default",
    label: "Ask",
    description: "Confirm before sensitive actions",
    icon: "eye",
    engines: ["studio", "claude"],
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-approve file edits, ask for the rest",
    icon: "pencil",
    engines: ["claude"],
  },
  {
    id: "plan",
    label: "Plan",
    description: "Plan only - no changes are made",
    icon: "compass",
    engines: ["claude"],
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Full autonomy - never ask",
    icon: "shield",
    engines: ["studio", "claude"],
  },
];

export function getPermissionModesForEngine(engine: ChatEngine): PermissionModeDef[] {
  return PERMISSION_MODES.filter((m) => m.engines.includes(engine));
}

export function getPermissionMode(id: PermissionModeId): PermissionModeDef | undefined {
  return PERMISSION_MODES.find((m) => m.id === id);
}

/**
 * Map Studio AI's legacy `autopilotMode` boolean onto the shared vocabulary, so
 * both engines describe permissions with the same ids.
 *   autopilot off -> "default" (ask / review)
 *   autopilot on  -> "bypassPermissions" (autonomous)
 */
export function studioModeFromAutopilot(autopilot: boolean): PermissionModeId {
  return autopilot ? "bypassPermissions" : "default";
}
