/**
 * WorkspaceShellChrome bundles the always-on workspace shell layers.
 */

import { HoverChrome } from "./HoverChrome";
import { FloatingPanel } from "./FloatingPanel";
import { WindowTrafficLights } from "./WindowTrafficLights";
import type { View } from "../types/navigation";

export function WorkspaceShellChrome({
  currentView,
  onNavigate,
}: {
  currentView: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <>
      <HoverChrome />
      <WindowTrafficLights />
      <FloatingPanel currentView={currentView} onNavigate={onNavigate} />
    </>
  );
}
