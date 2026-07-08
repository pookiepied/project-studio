/**
 * Shared navigation view type.
 * Used by HomePage, MainLayout, GlobalShortcutHandler, GlobalContextEvents.
 */
export type View =
  | "temporary"
  | "transcribe"
  | "chat"
  | "voice"
  | "profile"
  | "settings"
  | "memories"
  | "projects"
  | "workspace"
  | "extensions"
  | "activity"
  | "manage"
  | "help"
  | "computer";
