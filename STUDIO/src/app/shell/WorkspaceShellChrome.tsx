/**
 * WorkspaceShellChrome bundles the always-on workspace shell layers.
 *
 * The FloatingPanel dock is suppressed on pages that host their own top bar —
 * they render a HeaderNavButton inline instead, so nothing overlays the header.
 */

import { HoverChrome } from "./HoverChrome";
import { FloatingPanel } from "./FloatingPanel";
import { WindowTrafficLights } from "./WindowTrafficLights";
import type { View } from "@/types/navigation";

export function WorkspaceShellChrome({
  currentView,
  onNavigate,
  showDock = true,
}: {
  currentView: View;
  onNavigate: (view: View) => void;
  showDock?: boolean;
}) {
  return (
    <>
      <HoverChrome />
      <WindowTrafficLights />
      {showDock && <FloatingPanel currentView={currentView} onNavigate={onNavigate} />}
    </>
  );
}
