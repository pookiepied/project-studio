import { ReactNode, useState, useEffect, useLayoutEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { TitleBar } from "./TitleBar";
import { NavPopup } from "@/app/shell/NavPopup";
import { OfflineIndicator } from "@/app/globals/OfflineIndicator";
import { UpdateBanner } from "@/app/globals/UpdateBanner";
import { CommandPalette } from "@/app/command-palette/CommandPalette";
import { CommandPaletteProvider } from "@/app/contexts/CommandPaletteContext";
import { useSettings } from "@/app/contexts/SettingsContext";
import type { View } from "@/types/navigation";
import { resolveTheme } from "@/lib/theme";
import { isWorkspaceShell, WORKSPACE_SHELL } from "@/app/shell/shellConfig";
import { WorkspaceShellChrome } from "@/app/shell/WorkspaceShellChrome";
import { GlobalDockProvider } from "@/app/contexts/GlobalDockContext";

interface MainLayoutProps {
  children: ReactNode;
  currentView: View;
  onViewChange: (view: View) => void;
}

export const MainLayout = ({ children, currentView, onViewChange }: MainLayoutProps) => {
  const [navOpen, setNavOpen] = useState(false);
  const { settings } = useSettings();
  const workspaceShell = isWorkspaceShell();

  // Sync theme to <html> class so Tailwind dark: variants apply everywhere.
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = () => {
      const isDark = resolveTheme(settings.theme) === "dark";
      if (!root.dataset.themeInit) {
        root.classList.toggle("dark", isDark);
        root.dataset.themeInit = "1";
      } else {
        root.classList.add("theme-transitioning");
        root.classList.toggle("dark", isDark);
        window.setTimeout(() => root.classList.remove("theme-transitioning"), 320);
      }
    };

    applyTheme();
    try { localStorage.setItem("studio-theme", settings.theme ?? "system"); } catch {
      /* ignore storage failures */
    }

    if (settings.theme !== "system" || !window.matchMedia) return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme]);

  // Workspace shell: mark <html> so the solid native window gets the custom
  // surface and hover chrome. Removed in standard mode.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("zen-window", workspaceShell);
    // Single source of truth for the shell geometry. These vars drive both
    // the root surface (#root border-radius/inset) and the hover chrome
    // (.zen-chrome) so the minimize/close controls stay aligned to the real
    // window edge + radius.
    if (workspaceShell) {
      root.style.setProperty("--zen-frame-inset", `${WORKSPACE_SHELL.frameInset}px`);
      root.style.setProperty("--zen-frame-radius", `${WORKSPACE_SHELL.frameRadius}px`);
    } else {
      root.style.removeProperty("--zen-frame-inset");
      root.style.removeProperty("--zen-frame-radius");
    }
    return () => {
      root.classList.remove("zen-window");
      root.style.removeProperty("--zen-frame-inset");
      root.style.removeProperty("--zen-frame-radius");
    };
  }, [workspaceShell]);

  return (
    <CommandPaletteProvider>
    <GlobalDockProvider>
    <div
      className={
        workspaceShell
          ? "relative h-full w-full flex flex-col overflow-hidden transition-colors duration-300 bg-surface-page"
          : "relative h-full w-full flex flex-col overflow-hidden transition-colors duration-300 bg-surface-page"
      }
    >

      {/* Command palette — opened via title-bar search or Cmd/Ctrl+K */}
      <CommandPalette />

      {workspaceShell ? (
        /* ── Workspace shell chrome: hover controls +
              global floating panel (replaces TitleBar + NavPopup) ── */
        <WorkspaceShellChrome
          currentView={currentView}
          onNavigate={onViewChange}
        />
      ) : (
        <>
          {/* Title bar */}
          <TitleBar
            onToggle={() => setNavOpen((v) => !v)}
            navOpen={navOpen}
          />

          <OfflineIndicator />
          <UpdateBanner />

          {/* Floating nav popup */}
          <AnimatePresence>
            {navOpen && (
              <NavPopup
                currentView={currentView}
                onNavigate={(v) => { onViewChange(v); setNavOpen(false); }}
                onClose={() => setNavOpen(false)}
                onNewChat={() => { onViewChange("chat"); setNavOpen(false); }}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Full-width page content */}
      <div className="flex-1 overflow-hidden bg-surface-page">
        {children}
      </div>
    </div>
    </GlobalDockProvider>
    </CommandPaletteProvider>
  );
};
