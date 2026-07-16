import type { CliToolId } from "./cliTools";

export interface ChatTab {
  id: string;
  kind: "studio" | "cli";
  cliId?: CliToolId;
  title: string;
  /** Working directory to launch the CLI in (null = user home). */
  cwd?: string | null;
}

export const STUDIO_TAB_ID = "studio";
