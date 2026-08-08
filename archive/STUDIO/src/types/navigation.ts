/**
 * Shared navigation view type.
 * Used by HomePage, MainLayout, GlobalShortcutHandler, GlobalContextEvents.
 */
export type View =
  | "transcribe"
  | "chat"
  | "voice"
  | "profile"
  | "settings"
  | "memories"
  | "projects"
  | "workspace"
  | "artifacts"
  | "extensions"
  | "activity"
  | "manage"
  | "help"
  | "computer";
