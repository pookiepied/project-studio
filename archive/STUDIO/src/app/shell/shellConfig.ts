/**
 * Workspace shell preference + shared tunables.
 *
 * `workspace` is the current floating-panel shell. `standard` keeps the
 * previous TitleBar + NavPopup shell available as a fallback.
 *
 * Toggle at runtime from the devtools console:
 *     __studioShell('workspace') // current shell
 *     __studioShell('standard')  // previous shell
 *     __studioShell('reset')     // fall back to the default below
 * …then reload.
 */

const STORAGE_KEY = "studio-shell-mode";
const LEGACY_STORAGE_KEY = "studio-experiment-shell";

type ShellMode = "workspace" | "standard";

/** Default when nothing is stored. The carried-over shell is now the default. */
const DEFAULT_ENABLED = true;

function readStoredShellMode(): ShellMode | null {
  const mode = localStorage.getItem(STORAGE_KEY);
  if (mode === "workspace" || mode === "standard") return mode;

  const legacyMode = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyMode === "zen") return "workspace";
  if (legacyMode === "classic") return "standard";

  return null;
}

export function isWorkspaceShell(): boolean {
  try {
    const mode = readStoredShellMode();
    if (mode === "workspace") return true;
    if (mode === "standard") return false;
  } catch {
    /* ignore */
  }
  return DEFAULT_ENABLED;
}

// Expose a tiny console helper for quick A/B testing without rebuilding.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__studioShell = (mode: string) => {
    try {
      if (mode === "reset" || mode === "clear") {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } else if (mode === "workspace" || mode === "standard") {
        localStorage.setItem(STORAGE_KEY, mode);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } else if (mode === "zen") {
        localStorage.setItem(STORAGE_KEY, "workspace");
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } else if (mode === "classic") {
        localStorage.setItem(STORAGE_KEY, "standard");
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
    console.info(`[studio] shell → ${mode}. Reload to apply.`);
  };
}

/** Shared visual tunables — keep the workspace shell consistent across layers. */
export const WORKSPACE_SHELL = {
  /** App panel inset from the window edge.
   *  Keep this at zero while we tune the shell so the panel can sit flush with
   *  the native rounded window edge and avoid reading as a second bezel. */
  frameInset: 0,
  /** Corner radius of the app panel.
   *  With transparent: true the OS window is fully transparent, so this
   *  CSS radius IS the visible window shape — Mac-style rounded corners.
   *  The transparent areas outside this radius show the desktop behind. */
  frameRadius: 12,
  /** Height of the invisible hover hot-zone at the very top edge (px). */
  topHotZone: 8,
  /** How long controls stay revealed after the cursor leaves the top (ms). */
  chromeLingerMs: 600,
} as const;
