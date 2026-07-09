import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isWorkspaceShell, WORKSPACE_SHELL } from "./shell/shellConfig";
import { isThemePreference, resolveTheme } from "./utils/theme";

// Typography variables must load before the rest of the app styles.
// We intentionally use system font stacks for a compact Codex-like feel.
import "./styles/typography.css";
// Semantic design tokens (single source of truth) load before index.css so
// every global rule can read the CSS variables they define.
import "./tokens/tokens.css";
import "./index.css";
// Workspace-shell styles (scoped to .zen-* classes; inert unless used).
import "./shell/workspaceShell.css";
import { logger } from "./core/logging/logger";

logger.info("Main", "Starting STUDIO");

// Apply theme + workspace shell geometry before React mounts so the frameless window
// doesn't flash a borderless state during splash / initial paint.
if (typeof window !== "undefined") {
  const root = document.documentElement;
  const search = new URLSearchParams(window.location.search);
  const isOverlayWindow = search.get("w") === "overlay";
  const isSplashPreview = search.get("splashPreview") === "1";
  const isMainStudioWindow = !isOverlayWindow && !isSplashPreview;
  try {
    const storedTheme = localStorage.getItem("studio-theme");
    if (isThemePreference(storedTheme)) {
      root.classList.toggle("dark", resolveTheme(storedTheme) === "dark");
      root.dataset.themeInit = "1";
    }
  } catch {
    /* ignore */
  }

  if (isOverlayWindow) {
    root.classList.add("overlay-window");
  }

  if (isMainStudioWindow && isWorkspaceShell()) {
    root.classList.add("zen-window");
    root.style.setProperty("--zen-frame-inset", `${WORKSPACE_SHELL.frameInset}px`);
    root.style.setProperty("--zen-frame-radius", `${WORKSPACE_SHELL.frameRadius}px`);
  }
}

// WebView2 (Tauri's Chromium renderer) handles reload shortcuts itself, so
// we block them here to avoid losing app state in desktop mode.
if ((window as any).__TAURI_INTERNALS__ !== undefined) {
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
      }
    },
    true,
  );
}

window.addEventListener("error", (event) => {
  logger.error("Main", "Global error", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  logger.error("Main", "Unhandled promise rejection", event.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
