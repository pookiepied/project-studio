import { createContext, useContext, ReactNode } from "react";
import { useModels } from "./useModels";
import type { UseModelsResult } from "./useModels";

const ModelsContext = createContext<UseModelsResult | null>(null);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const models = useModels();
  return <ModelsContext.Provider value={models}>{children}</ModelsContext.Provider>;
}

export function useModelsContext(): UseModelsResult {
  const ctx = useContext(ModelsContext);
  if (!ctx) throw new Error("useModelsContext must be used within ModelsProvider");
  return ctx;
}
