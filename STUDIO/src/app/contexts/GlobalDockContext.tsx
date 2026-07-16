/* eslint-disable react-refresh/only-export-components -- provider and hook form one context API. */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface GlobalDockContextValue {
  chatDockVisible: boolean;
  setChatDockVisible: (visible: boolean) => void;
  toggleChatDock: () => void;
}

const GlobalDockContext = createContext<GlobalDockContextValue | null>(null);

export function GlobalDockProvider({ children }: { children: ReactNode }) {
  const [chatDockVisible, setChatDockVisible] = useState(false);
  const value = useMemo(() => ({
    chatDockVisible,
    setChatDockVisible,
    toggleChatDock: () => setChatDockVisible((visible) => !visible),
  }), [chatDockVisible]);
  return <GlobalDockContext.Provider value={value}>{children}</GlobalDockContext.Provider>;
}

export function useGlobalDock(): GlobalDockContextValue {
  const value = useContext(GlobalDockContext);
  if (!value) throw new Error("useGlobalDock must be used within GlobalDockProvider");
  return value;
}
