import type { CliToolId } from "./cliTools";

export interface ChatTab {
  id: string;
  kind: "studio" | "cli";
  cliId?: CliToolId;
  title: string;
}

export const STUDIO_TAB_ID = "studio";
