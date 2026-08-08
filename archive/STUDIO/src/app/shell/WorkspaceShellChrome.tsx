/** Bundles the always-on workspace chrome, including the single global dock. */

import { HoverChrome } from "./HoverChrome";
import { FloatingPanel } from "./FloatingPanel";
import { WindowTrafficLights } from "./WindowTrafficLights";
import type { View } from "@/types/navigation";

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
