import { useCallback, useState } from "react";
import { getCliTool, type CliToolId } from "./cliTools";
import { STUDIO_TAB_ID, type ChatTab } from "./types";

const STUDIO_TAB: ChatTab = { id: STUDIO_TAB_ID, kind: "studio", title: "Studio" };

let _seq = 0;

/** Browser-style chat tab state: Studio is the permanent primary tab; CLI
 *  terminals can be opened / closed alongside it. */
export function useChatTabs() {
  const [tabs, setTabs] = useState<ChatTab[]>([STUDIO_TAB]);
  const [activeId, setActiveId] = useState<string>(STUDIO_TAB_ID);

  const openCli = useCallback((cliId: CliToolId) => {
    const title = getCliTool(cliId).label;
    const id = `cli-${++_seq}-${Date.now()}`;
    setTabs((prev) => [...prev, { id, kind: "cli", cliId, title }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    if (id === STUDIO_TAB_ID) return;
    setTabs((prev) => prev.filter((t) => t.id !== id));
    // If the closed tab was active, fall back to Studio (always present).
    setActiveId((curr) => (curr === id ? STUDIO_TAB_ID : curr));
  }, []);

  return { tabs, activeId, setActiveId, openCli, closeTab };
}
