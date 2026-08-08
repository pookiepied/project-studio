/**
 * OverlayPage — root component rendered inside the always-on overlay Tauri window.
 *
 * Loaded when the URL contains ?w=overlay (see App.tsx).
 * Intentionally bypasses the full app provider chain to stay lightweight.
 *
 * Responsibilities:
 *  1. Position the window at the center-top of the current monitor once.
 *  2. Apply the correct dark/light class for Tailwind.
 *  3. Accept theme overrides from the main window via events.
 *  4. Forward "studio:overlay-update" payloads to FloatingIsland.
 *  5. Relay user actions back to the main window via "studio:overlay-action".
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { listen, emit } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { FloatingIsland } from "@/features/voice/overlay/FloatingIsland";
import { RecordingState } from "@/types";
import type { OverlayPayload, OverlayActionType } from "@/core/platform/overlayService";
import { deriveIslandViewState, getIslandWindowSize } from "@/core/platform/islandViewState";

export function OverlayPage() {
  const [payload, setPayload] = useState<OverlayPayload>({
    state: RecordingState.IDLE,
    mode: "global",
    opacity: 70,
  });
  const [idleExpanded, setIdleExpanded] = useState(false);
  const [windowReady, setWindowReady] = useState(false);
  const windowSizeRef = useRef<{ width: number; height: number } | null>(null);
  const view = useMemo(
    () => deriveIslandViewState(payload, idleExpanded),
    [payload, idleExpanded]
  );

  const positionWindow = useCallback(async (size: { width: number; height: number }) => {
    const last = windowSizeRef.current;

    if (last?.width === size.width && last?.height === size.height) {
      return;
    }

    const win = getCurrentWindow();
    const monitor = await currentMonitor();

    await win.setSize(new LogicalSize(size.width, size.height));
    if (monitor) {
      const logicalW = monitor.size.width / monitor.scaleFactor;
      const x = Math.round((logicalW - size.width) / 2);
      await win.setPosition(new LogicalPosition(x, 0));
    }
    windowSizeRef.current = size;
  }, []);

  // ── 0. Transparent body ──────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // ── 1. Dark-mode tracking ────────────────────────────────────────────────
  // Read the theme that MainLayout already wrote to localStorage ("studio-theme").
  // This gives us the correct app theme instantly — no timing race with the
  // studio:overlay-theme event.  Falls back to OS preference if the key is absent
  // (e.g. first-ever launch before any settings are saved).
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem("studio-theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Keep listening to OS changes so the overlay isn't completely disconnected
  // from the system (fallback for when the main window sends no override).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Studio app theme — always takes precedence over OS preference.
  // init() in overlayService sends this after the window is confirmed ready,
  // so this listener will always receive the initial value.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ dark: boolean }>("studio:overlay-theme", (e) => {
      setIsDark(e.payload.dark);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => { unlisten?.(); };
  }, []);

  // ── 2. Position window at center-top of screen, then reveal it (once) ───
  // The window is created with visible:false in overlayService to avoid the
  // "full-window flash at (0,0)" artifact.  We position it first, then show it.
  useEffect(() => {
    (async () => {
      try {
        const win = getCurrentWindow();
        await positionWindow(getIslandWindowSize(deriveIslandViewState({
          state: RecordingState.IDLE,
          mode: "global",
          opacity: 70,
        })));
        // Reveal only after position is set — no more startup flash
        await win.show();
        setWindowReady(true);
      } catch (err) {
        console.warn("[OverlayPage] positioning failed:", err);
        // Make sure window is visible even if positioning fails
        try { await getCurrentWindow().show(); } catch { /* not fatal */ }
        setWindowReady(true);
      }
    })();
  }, [positionWindow]);

  useEffect(() => {
    if (!windowReady) return;
    positionWindow(getIslandWindowSize(view)).catch((err) => {
      console.warn("[OverlayPage] resize failed:", err);
    });
  }, [positionWindow, view, windowReady]);

  // ── 3. Listen for state updates from main window ─────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<OverlayPayload>("studio:overlay-update", (event) => {
      setPayload(event.payload);
      if (event.payload.state !== RecordingState.IDLE || event.payload.opacity === 0) {
        setIdleExpanded(false);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => { unlisten?.(); };
  }, []);

  // ── 4. Forward overlay actions to the main window ────────────────────────
  const handleAction = useCallback(async (action: OverlayActionType, text?: string) => {
    setIdleExpanded(false);
    try {
      await emit("studio:overlay-action", { action, text });
    } catch {
      // Main window closed — handle locally
      if (action === "dismiss" || action === "new") {
        getCurrentWindow().close().catch(() => null);
      }
    }
  }, []);

  const handleIdleExpandedChange = useCallback(async (expanded: boolean) => {
    if (!expanded) {
      setIdleExpanded(false);
      return;
    }

    const expandedView = deriveIslandViewState(payload, true);
    await positionWindow(getIslandWindowSize(expandedView)).catch(() => null);
    window.requestAnimationFrame(() => setIdleExpanded(true));
  }, [payload, positionWindow]);

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100vw", height: "100vh", background: "transparent", overflow: "hidden" }}
    >
      <FloatingIsland
        payload={payload}
        ready={windowReady}
        idleExpanded={idleExpanded}
        onIdleExpandedChange={handleIdleExpandedChange}
        onAction={handleAction}
      />
    </div>
  );
}
