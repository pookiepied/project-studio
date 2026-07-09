import { useEffect } from "react";

/**
 * Lightweight coordinator for the top-right floating panels
 * (Overview, Tools/Terminal, Notifications).
 *
 * These panels live in different component trees (ChatPage vs TitleBar), so we
 * coordinate them through a window event rather than shared React state. Each
 * panel opts in: it broadcasts when it opens and closes itself when a *different*
 * panel opens. Closing flows through each panel's existing AnimatePresence, so
 * the swap is animated for free.
 */

const EVENT = "studio:exclusive-panel-open";

/** Call when a panel opens so the other exclusive panels close themselves. */
export function broadcastPanelOpen(id: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id } }));
}

/**
 * Closes this panel when a different exclusive panel opens.
 *
 * @param id      unique id for this panel ("overview" | "tools" | "notifications")
 * @param isOpen  whether this panel is currently open
 * @param close   callback that closes this panel
 */
export function useExclusivePanel(id: string, isOpen: boolean, close: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: Event) => {
      const openedId = (e as CustomEvent<{ id: string }>).detail?.id;
      if (openedId && openedId !== id) close();
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [id, isOpen, close]);
}
