/**
 * WindowTrafficLights — permanent custom window controls for the frameless
 * workspace shell.
 *
 * This stays inside the main app window. No detached transparent window, no
 * Pulse overlay involvement.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "@/ui/primitives/IconButton";
import { environmentService } from "@/core/platform/environmentService";
import { logger } from "@/core/logging/logger";

const DOT_SIZE = 10;
// Shared top-row center line (px). Must match the FloatingPanel dock center and
// the .studio-chat-header center in workspaceShell.css. The dock sits at 23px
// (top-[5.5px] + h-[35px]/2) at the 14px root font, so the window controls and
// chat-header controls all align to that line.
const TOP_ROW_CENTER_Y = 23;
const TOP_OFFSET = TOP_ROW_CENTER_Y - DOT_SIZE / 2;
const LEFT_OFFSET = 14;
const DOT_GAP = 8;

type LightKind = "close" | "minimize" | "maximize";

/* macOS traffic-light hues — fixed OS-chrome colours, not themeable design tokens */
/* eslint-disable no-restricted-syntax */
const LIGHTS: Array<{ kind: LightKind; color: string; label: string }> = [
  { kind: "close",    color: "#FF5F57", label: "Close" },
  { kind: "minimize", color: "#FFBD2E", label: "Minimize" },
  { kind: "maximize", color: "#28C840", label: "Zoom" },
];
/* eslint-enable no-restricted-syntax */

export function WindowTrafficLights() {
  const isTauri = environmentService.isTauri();

  if (!isTauri) return null;

  const handleClick = async (kind: LightKind) => {
    try {
      const win = getCurrentWindow();
      if (kind === "close") {
        await win.close();
      } else if (kind === "minimize") {
        await win.minimize();
      } else {
        await win.toggleMaximize();
      }
    } catch (error) {
      logger.error("WindowTrafficLights", `Failed to ${kind} window`, error);
    }
  };

  return (
    <div
      className="pointer-events-auto fixed z-toast flex items-center"
      style={{ left: LEFT_OFFSET, top: TOP_OFFSET, gap: DOT_GAP }}
    >
      {LIGHTS.map(({ kind, color, label }) => (
        <IconButton
          key={kind}
          onClick={() => handleClick(kind)}
          aria-label={label}
          className="rounded-full ring-1 ring-surface-border transition-opacity hover:opacity-80 active:opacity-60"
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            backgroundColor: color,
          }}
        >
          {null}
        </IconButton>
      ))}
    </div>
  );
}
