import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface CommandPaletteContextType {
  open:    boolean;
  setOpen: (v: boolean) => void;
  toggle:  () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextType | null>(null);

/**
 * Owns the command-palette open state and the global Cmd/Ctrl+K shortcut, so
 * both the title-bar search trigger and the keyboard shortcut drive the same
 * popup.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, toggle }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextType {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}
