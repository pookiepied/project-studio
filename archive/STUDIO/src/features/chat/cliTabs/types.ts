import type { CliToolId } from "./cliTools";

export interface ChatTab {
  id: string;
  kind: "studio" | "cli";
  cliId?: CliToolId;
  title: string;
  /** Working directory to launch the CLI in (null = user home). */
  cwd?: string | null;
  /** Compact workspace metadata for the informational hover card. */
  workspaceLabel?: string;
}

export interface ChatTabPersistenceContext {
  scope: "local" | "cloud";
  projectPath?: string | null;
  conversationId?: string | null;
}

export interface PersistedChatTabs {
  version: 1;
  tabs: ChatTab[];
  activeId: string;
}

export const STUDIO_TAB_ID = "studio";
