/**
 * HoverChrome — draggable top-edge strip for the frameless workspace shell.
 *
 * Replaces the always-visible TitleBar. Renders an invisible hot-zone at the
 * very top edge that's a Tauri drag-region, so the frameless window can still
 * be moved. Minimize/close are rendered by WindowTrafficLights inside the main
 * app window.
 */

import { environmentService } from "../core/platform/environmentService";
import { WORKSPACE_SHELL } from "./shellConfig";

export function HoverChrome() {
  const isTauri = environmentService.isTauri();

  return (
    <div
      className="zen-hotzone"
      data-tauri-drag-region={isTauri ? "" : undefined}
      style={{ "--zen-hotzone": `${WORKSPACE_SHELL.topHotZone}px` } as React.CSSProperties}
    />
  );
}
