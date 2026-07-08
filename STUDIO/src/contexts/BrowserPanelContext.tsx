import { createContext, useContext } from "react";

interface BrowserPanelContextValue {
  openHtml: (html: string) => void;
}

export const BrowserPanelContext = createContext<BrowserPanelContextValue>({
  openHtml: () => {},
});

export const useBrowserPanel = () => useContext(BrowserPanelContext);
