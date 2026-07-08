import { createContext, useContext } from "react";

export interface ArtifactPanelContextValue {
  openCode:     (content: string, language: string, label: string) => void;
  openDocument: (content: string, label: string) => void;
}

export const ArtifactPanelContext = createContext<ArtifactPanelContextValue>({
  openCode:     () => {},
  openDocument: () => {},
});

export function useArtifactPanelContext() {
  return useContext(ArtifactPanelContext);
}
