/**
 * Navigation Context
 * 
 * Provides navigation control across the app.
 * Allows components to trigger view changes (e.g., navigate to chat after sending transcription).
 */

import { createContext, useContext, ReactNode } from "react";
import type { View } from "../types/navigation";

interface NavigationContextType {
  currentView: View;
  navigateTo: (view: View) => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

interface NavigationProviderProps {
  children: ReactNode;
  currentView: View;
  onNavigate: (view: View) => void;
}

export const NavigationProvider = ({ children, currentView, onNavigate }: NavigationProviderProps) => {
  return (
    <NavigationContext.Provider
      value={{
        currentView,
        navigateTo: onNavigate,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return context;
};
